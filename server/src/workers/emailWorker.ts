import { Worker, Job, UnrecoverableError } from 'bullmq';
import fs from 'fs';
import { config } from '../config';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { generateTrackingToken } from '../utils/crypto';
import { renderTemplate } from '../utils/templateRenderer';
import { createProvider } from '../services/email/providerFactory';
import { emailSendQueue } from '../queues/emailQueue';
import {
  PermanentBounceError, TemporaryBounceError, RateLimitError, AuthenticationError,
  EmailAttachment,
} from '../services/email/EmailProvider';

interface DispatchJobData {
  campaignId: string;
}

interface AttachmentMeta {
  filename: string;
  storagePath: string;
  size: number;
  contentType: string;
}

interface SendJobData {
  campaignRecipientId: string;
  campaignId: string;
  email: string;
  subject: string;
  html: string;
  text: string | null;
  provider: string;
  providerConfig: Record<string, unknown>;
  trackingToken: string;
  trackingDomain: string;
  attachments?: AttachmentMeta[];
  replyTo?: string;
}

export function startCampaignDispatchWorker(): Worker {
  const worker = new Worker<DispatchJobData>(
    'campaign-dispatch',
    async (job: Job<DispatchJobData>) => {
      const { campaignId } = job.data;
      logger.info(`Dispatching campaign ${campaignId}`);

      // Load campaign
      const campResult = await pool.query(
        'SELECT * FROM campaigns WHERE id = $1', [campaignId]
      );
      if (campResult.rows.length === 0) throw new Error('Campaign not found');
      const campaign = campResult.rows[0];

      if (campaign.status === 'paused') {
        logger.info(`Campaign ${campaignId} is paused, skipping dispatch`);
        return;
      }

      // Load template
      const tplResult = await pool.query(
        'SELECT * FROM templates WHERE id = $1', [campaign.template_id]
      );
      if (tplResult.rows.length === 0) throw new Error('Template not found');
      const template = tplResult.rows[0];

      // Load provider config
      const providerResult = await pool.query("SELECT value FROM settings WHERE key = $1", [
        campaign.provider === 'gmail' ? 'gmail_config' : 'ses_config'
      ]);
      const providerConfig = providerResult.rows[0]?.value || {};

      // Load tracking domain
      const trackingResult = await pool.query("SELECT value FROM settings WHERE key = 'tracking_domain'");
      const trackingDomain = trackingResult.rows[0]?.value || 'http://localhost:3001';

      // Load reply-to setting
      const replyToResult = await pool.query("SELECT value FROM settings WHERE key = 'reply_to'");
      let replyTo: string | undefined;
      if (replyToResult.rows[0]?.value) {
        const raw = replyToResult.rows[0].value;
        if (typeof raw === 'string' && raw.length > 0 && raw.includes('@')) {
          replyTo = raw;
        } else if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string' && parsed.length > 0) {
              replyTo = parsed;
            }
          } catch {
            // not JSON, skip
          }
        }
      }

      // Load campaign attachments
      const campaignAttachments: AttachmentMeta[] = campaign.attachments || [];

      // Load contacts from list (only active, not bounced/complained/unsubscribed)
      // Check if the list is a smart list
      const listResult = await pool.query(
        'SELECT is_smart, filter_criteria FROM contact_lists WHERE id = $1',
        [campaign.list_id]
      );
      if (listResult.rows.length === 0) throw new Error('Contact list not found');
      const list = listResult.rows[0];

      let contactsResult;
      if (list.is_smart && list.filter_criteria) {
        // Smart list: build dynamic query from filter_criteria
        const criteria = typeof list.filter_criteria === 'string'
          ? JSON.parse(list.filter_criteria) : list.filter_criteria;
        const filterParams: unknown[] = [];
        let filterWhere = '';
        let paramIndex = 1;

        if (criteria.state && Array.isArray(criteria.state) && criteria.state.length > 0) {
          filterWhere += ` AND c.state = ANY($${paramIndex})`;
          filterParams.push(criteria.state);
          paramIndex++;
        }
        if (criteria.district && Array.isArray(criteria.district) && criteria.district.length > 0) {
          filterWhere += ` AND c.district = ANY($${paramIndex})`;
          filterParams.push(criteria.district);
          paramIndex++;
        }
        if (criteria.block && Array.isArray(criteria.block) && criteria.block.length > 0) {
          filterWhere += ` AND c.block = ANY($${paramIndex})`;
          filterParams.push(criteria.block);
          paramIndex++;
        }
        if (criteria.category && Array.isArray(criteria.category) && criteria.category.length > 0) {
          filterWhere += ` AND c.category = ANY($${paramIndex})`;
          filterParams.push(criteria.category);
          paramIndex++;
        }
        if (criteria.management && Array.isArray(criteria.management) && criteria.management.length > 0) {
          filterWhere += ` AND c.management = ANY($${paramIndex})`;
          filterParams.push(criteria.management);
          paramIndex++;
        }
        if (criteria.classes_min != null) {
          filterWhere += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 2) AS integer) >= $${paramIndex} ELSE true END`;
          filterParams.push(criteria.classes_min);
          paramIndex++;
        }
        if (criteria.classes_max != null) {
          filterWhere += ` AND CASE WHEN c.classes ~ '^[0-9]+-[0-9]+$' THEN CAST(split_part(c.classes, '-', 1) AS integer) <= $${paramIndex} ELSE true END`;
          filterParams.push(criteria.classes_max);
          paramIndex++;
        }

        contactsResult = await pool.query(
          `SELECT c.id, c.email, c.name, c.state, c.district, c.block, c.classes, c.category, c.management, c.address, c.metadata FROM contacts c
           WHERE c.status = 'active' ${filterWhere}
           AND c.id NOT IN (SELECT contact_id FROM campaign_recipients WHERE campaign_id = $${paramIndex} AND contact_id IS NOT NULL)`,
          [...filterParams, campaignId]
        );
      } else {
        // Regular list: use contact_list_members join
        contactsResult = await pool.query(
          `SELECT c.id, c.email, c.name, c.state, c.district, c.block, c.classes, c.category, c.management, c.address, c.metadata FROM contacts c
           JOIN contact_list_members clm ON clm.contact_id = c.id
           WHERE clm.list_id = $1 AND c.status = 'active'
           AND c.id NOT IN (SELECT contact_id FROM campaign_recipients WHERE campaign_id = $2 AND contact_id IS NOT NULL)`,
          [campaign.list_id, campaignId]
        );
      }

      const contacts = contactsResult.rows;
      logger.info(`Campaign ${campaignId}: ${contacts.length} recipients to process`);

      // Update total recipients
      await pool.query(
        'UPDATE campaigns SET total_recipients = total_recipients + $1, updated_at = NOW() WHERE id = $2',
        [contacts.length, campaignId]
      );

      // Create campaign_recipients and enqueue send jobs
      for (const contact of contacts) {
        const trackingToken = generateTrackingToken();

        // Render template for this contact — all standard fields + custom metadata
        const variables: Record<string, string> = {
          school_name: contact.name || '',
          name: contact.name || '',
          email: contact.email,
          state: contact.state || '',
          district: contact.district || '',
          block: contact.block || '',
          classes: contact.classes || '',
          category: contact.category || '',
          management: contact.management || '',
          address: contact.address || '',
        };
        // Merge custom metadata keys (e.g. principal_name, phone, etc.)
        if (contact.metadata && typeof contact.metadata === 'object') {
          for (const [key, val] of Object.entries(contact.metadata)) {
            if (typeof val === 'string' || typeof val === 'number') {
              variables[key] = String(val);
            }
          }
        }
        const renderedHtml = renderTemplate(template.html_body, variables);
        const renderedSubject = renderTemplate(template.subject, variables);
        const renderedText = template.text_body ? renderTemplate(template.text_body, variables) : null;

        // Insert campaign_recipient
        const crResult = await pool.query(
          `INSERT INTO campaign_recipients (campaign_id, contact_id, email, tracking_token)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [campaignId, contact.id, contact.email, trackingToken]
        );

        // Enqueue email send job
        await emailSendQueue.add('send', {
          campaignRecipientId: crResult.rows[0].id,
          campaignId,
          email: contact.email,
          subject: renderedSubject,
          html: renderedHtml,
          text: renderedText,
          provider: campaign.provider,
          providerConfig,
          trackingToken,
          trackingDomain,
          attachments: campaignAttachments,
          replyTo,
        } as SendJobData, {
          // Rate limiting delay based on throttle settings
          delay: 0,
        });
      }

      logger.info(`Campaign ${campaignId}: ${contacts.length} send jobs enqueued`);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Campaign dispatch failed: ${err.message}`, { jobId: job?.id });
  });

  return worker;
}

export function startEmailSendWorker(): Worker {
  const worker = new Worker<SendJobData>(
    'email-send',
    async (job: Job<SendJobData>) => {
      const { campaignRecipientId, campaignId, email, subject, html, text, provider, providerConfig, trackingToken, trackingDomain, replyTo } = job.data;

      // Check if campaign is paused
      const campCheck = await pool.query('SELECT status FROM campaigns WHERE id = $1', [campaignId]);
      if (campCheck.rows[0]?.status === 'paused') {
        // Re-queue with delay
        throw new Error('Campaign paused');
      }

      // Inject tracking pixel
      const pixelUrl = `${trackingDomain}/api/v1/t/o/${trackingToken}`;
      const trackingPixel = `<img src="${pixelUrl}" width="1" height="1" style="display:block" alt="" />`;
      let trackedHtml = html.replace('</body>', `${trackingPixel}</body>`);
      if (!trackedHtml.includes(trackingPixel)) {
        trackedHtml += trackingPixel;
      }

      // Rewrite links for click tracking
      const linkUrls: string[] = [];
      let linkIndex = 0;
      trackedHtml = trackedHtml.replace(/<a\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi, (_match, pre, url, post) => {
        if (url.startsWith('mailto:') || url.startsWith('#')) return `<a ${pre}href="${url}"${post}>`;
        linkUrls.push(url);
        const trackUrl = `${trackingDomain}/api/v1/t/c/${trackingToken}/${linkIndex}`;
        linkIndex++;
        return `<a ${pre}href="${trackUrl}"${post}>`;
      });

      // Store link URLs
      await pool.query('UPDATE campaign_recipients SET link_urls = $1 WHERE id = $2', [JSON.stringify(linkUrls), campaignRecipientId]);

      // Build headers
      const unsubUrl = `${trackingDomain}/api/v1/t/u/${trackingToken}`;
      const headers: Record<string, string> = {
        'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@yourdomain.com?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Feedback-ID': `${campaignId}:cadencerelay`,
      };

      // Load attachments from disk
      const emailAttachments: EmailAttachment[] = [];
      if (job.data.attachments && job.data.attachments.length > 0) {
        for (const att of job.data.attachments) {
          if (fs.existsSync(att.storagePath)) {
            emailAttachments.push({
              filename: att.filename,
              content: fs.readFileSync(att.storagePath),
              contentType: att.contentType,
            });
          } else {
            logger.warn(`Attachment file not found: ${att.storagePath}`, { filename: att.filename });
          }
        }
      }

      // Send email - catch and classify errors
      const emailProvider = createProvider(provider, providerConfig);
      let result;
      try {
        result = await emailProvider.send({
          to: email,
          subject,
          html: trackedHtml,
          text: text || undefined,
          replyTo,
          headers,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        });
      } catch (sendErr) {
        // Permanent bounces should not be retried
        if (sendErr instanceof PermanentBounceError) {
          throw new UnrecoverableError(sendErr.message);
        }
        // Auth errors should not be retried (campaign will be paused)
        if (sendErr instanceof AuthenticationError) {
          throw new UnrecoverableError(sendErr.message);
        }
        // Rate limits and temporary errors: rethrow for BullMQ retry
        throw sendErr;
      }

      // Update campaign_recipient
      await pool.query(
        "UPDATE campaign_recipients SET status = 'sent', provider_message_id = $1, sent_at = NOW() WHERE id = $2",
        [result.messageId, campaignRecipientId]
      );

      // Record event
      await pool.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, metadata) VALUES ($1, $2, 'sent', $3)",
        [campaignRecipientId, campaignId, JSON.stringify({ messageId: result.messageId, provider })]
      );

      // Update denormalized counters
      await pool.query(
        'UPDATE campaigns SET sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1',
        [campaignId]
      );
      await pool.query(
        'UPDATE contacts SET send_count = send_count + 1, last_sent_at = NOW() WHERE email = $1',
        [email]
      );

      // Check if campaign is complete
      const stats = await pool.query(
        'SELECT total_recipients, sent_count, failed_count, bounce_count FROM campaigns WHERE id = $1',
        [campaignId]
      );
      const camp = stats.rows[0];
      if (camp && (Number(camp.sent_count) + Number(camp.failed_count) + Number(camp.bounce_count)) >= Number(camp.total_recipients)) {
        await pool.query(
          "UPDATE campaigns SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [campaignId]
        );
        logger.info(`Campaign ${campaignId} completed`);
      }

      logger.debug(`Email sent to ${email}`, { messageId: result.messageId });
    },
    {
      connection: { url: config.redis.url },
      concurrency: 10,
      limiter: {
        max: 5,
        duration: 1000,
      },
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { campaignRecipientId, campaignId, email } = job.data;

    // Classify the error for proper handling
    const isPermanentBounce = err instanceof PermanentBounceError || err.name === 'PermanentBounceError';
    const isAuthError = err instanceof AuthenticationError || err.name === 'AuthenticationError';
    const isRateLimit = err instanceof RateLimitError || err.name === 'RateLimitError';
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 3);

    if (isPermanentBounce) {
      // Permanent bounce: mark as bounced immediately, don't retry
      logger.warn(`Permanent bounce for ${email}: ${err.message}`);

      await pool.query(
        "UPDATE campaign_recipients SET status = 'bounced', bounced_at = NOW(), error_message = $1 WHERE id = $2 AND status != 'bounced'",
        [err.message, campaignRecipientId]
      );
      await pool.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, metadata) VALUES ($1, $2, 'bounced', $3)",
        [campaignRecipientId, campaignId, JSON.stringify({
          bounceType: 'Permanent',
          error: err.message,
          source: 'smtp-rejection',
          provider: job.data.provider,
        })]
      );
      await pool.query(
        'UPDATE campaigns SET bounce_count = bounce_count + 1, updated_at = NOW() WHERE id = $1',
        [campaignId]
      );
      // Mark contact as bounced
      await pool.query(
        "UPDATE contacts SET status = 'bounced', bounce_count = bounce_count + 1, updated_at = NOW() WHERE email = $1",
        [email]
      );
    } else if (isAuthError) {
      // Auth error: stop the whole campaign, not just this email
      logger.error(`Authentication error: ${err.message}. Pausing campaign ${campaignId}`);

      await pool.query(
        "UPDATE campaign_recipients SET status = 'failed', error_message = $1 WHERE id = $2",
        [`Auth error: ${err.message}`, campaignRecipientId]
      );
      await pool.query(
        "UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'sending'",
        [campaignId]
      );
    } else if (isRateLimit) {
      // Rate limit: will be retried automatically by BullMQ backoff
      logger.warn(`Rate limited for ${email}, attempt ${job.attemptsMade}/${job.opts.attempts}: ${err.message}`);

      if (isFinalAttempt) {
        await pool.query(
          "UPDATE campaign_recipients SET status = 'failed', error_message = $1 WHERE id = $2",
          [`Rate limited after ${job.attemptsMade} attempts: ${err.message}`, campaignRecipientId]
        );
        await pool.query(
          'UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1',
          [campaignId]
        );
      }
    } else if (isFinalAttempt) {
      // Other errors on final attempt
      logger.error(`Email send failed permanently for ${email}: ${err.message}`);

      await pool.query(
        "UPDATE campaign_recipients SET status = 'failed', error_message = $1 WHERE id = $2",
        [err.message, campaignRecipientId]
      );
      await pool.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, metadata) VALUES ($1, $2, 'failed', $3)",
        [campaignRecipientId, campaignId, JSON.stringify({ error: err.message, provider: job.data.provider })]
      );
      await pool.query(
        'UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1',
        [campaignId]
      );
    } else {
      // Temporary error, will retry
      logger.warn(`Temporary failure for ${email}, attempt ${job.attemptsMade}/${job.opts.attempts}: ${err.message}`);
    }

    // Check campaign completion after any terminal state
    if (isPermanentBounce || isFinalAttempt || isAuthError) {
      const stats = await pool.query(
        'SELECT total_recipients, sent_count, failed_count, bounce_count FROM campaigns WHERE id = $1',
        [campaignId]
      );
      const camp = stats.rows[0];
      if (camp && (Number(camp.sent_count) + Number(camp.failed_count) + Number(camp.bounce_count)) >= Number(camp.total_recipients)) {
        await pool.query(
          "UPDATE campaigns SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'sending'",
          [campaignId]
        );
        logger.info(`Campaign ${campaignId} completed (with ${camp.bounce_count} bounces, ${camp.failed_count} failures)`);
      }
    }
  });

  return worker;
}
