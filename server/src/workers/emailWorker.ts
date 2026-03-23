import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { generateTrackingToken } from '../utils/crypto';
import { renderTemplate } from '../utils/templateRenderer';
import { createProvider } from '../services/email/providerFactory';
import { emailSendQueue } from '../queues/emailQueue';

interface DispatchJobData {
  campaignId: string;
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

      // Load contacts from list (only active, not bounced/complained/unsubscribed)
      const contactsResult = await pool.query(
        `SELECT c.id, c.email, c.name FROM contacts c
         JOIN contact_list_members clm ON clm.contact_id = c.id
         WHERE clm.list_id = $1 AND c.status = 'active'
         AND c.id NOT IN (SELECT contact_id FROM campaign_recipients WHERE campaign_id = $2 AND contact_id IS NOT NULL)`,
        [campaign.list_id, campaignId]
      );

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

        // Render template for this contact
        const variables: Record<string, string> = {
          school_name: contact.name || '',
          name: contact.name || '',
          email: contact.email,
        };
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
      const { campaignRecipientId, campaignId, email, subject, html, text, provider, providerConfig, trackingToken, trackingDomain } = job.data;

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
        'Feedback-ID': `${campaignId}:bulkmailer`,
      };

      // Send email
      const emailProvider = createProvider(provider, providerConfig);
      const result = await emailProvider.send({
        to: email,
        subject,
        html: trackedHtml,
        text: text || undefined,
        headers,
      });

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
        'SELECT total_recipients, sent_count, failed_count FROM campaigns WHERE id = $1',
        [campaignId]
      );
      const camp = stats.rows[0];
      if (camp && (camp.sent_count + camp.failed_count) >= camp.total_recipients) {
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
    logger.error(`Email send failed: ${err.message}`, { email });

    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      // Final failure
      await pool.query(
        "UPDATE campaign_recipients SET status = 'failed', error_message = $1 WHERE id = $2",
        [err.message, campaignRecipientId]
      );
      await pool.query(
        "INSERT INTO email_events (campaign_recipient_id, campaign_id, event_type, metadata) VALUES ($1, $2, 'failed', $3)",
        [campaignRecipientId, campaignId, JSON.stringify({ error: err.message })]
      );
      await pool.query(
        'UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1',
        [campaignId]
      );
    }
  });

  return worker;
}
