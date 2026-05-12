import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { renderTemplate, htmlToPlainText } from '../utils/templateRenderer';
import { createProvider } from '../services/email/providerFactory';
import { checkDailyLimit, incrementDailySend } from '../utils/dailyLimits';
import { isEmailSuppressed } from '../controllers/suppression.controller';
import { resolveTrackingDomain } from '../utils/trackingDomain';
import { generateContactUnsubToken } from '../utils/unsubscribeToken';
import { ensureUnsubscribeFooter } from '../utils/unsubscribeFooter';

function buildContactVariables(contact: Record<string, unknown>): Record<string, string> {
  const variables: Record<string, string> = {
    school_name: (contact.name as string) || '',
    name: (contact.name as string) || '',
    email: (contact.email as string) || '',
    state: (contact.state as string) || '',
    district: (contact.district as string) || '',
    block: (contact.block as string) || '',
    classes: (contact.classes as string) || '',
    category: (contact.category as string) || '',
    management: (contact.management as string) || '',
    address: (contact.address as string) || '',
  };
  if (contact.metadata && typeof contact.metadata === 'object') {
    for (const [key, val] of Object.entries(contact.metadata as Record<string, unknown>)) {
      if (typeof val === 'string' || typeof val === 'number') {
        variables[key] = String(val);
      }
    }
  }
  return variables;
}

export async function processAutomationSteps(): Promise<void> {
  const client = await pool.connect();
  try {
    // Fetch due enrollments with row-level locking
    const enrollments = await client.query(
      `SELECT ae.id, ae.automation_id, ae.contact_id, ae.current_step,
              a.provider, a.status AS automation_status
       FROM automation_enrollments ae
       JOIN automations a ON a.id = ae.automation_id
       WHERE ae.status = 'active'
         AND ae.next_step_at <= NOW()
         AND a.status = 'active'
       LIMIT 100
       FOR UPDATE OF ae SKIP LOCKED`
    );

    if (enrollments.rows.length === 0) return;

    let processedCount = 0;

    for (const enrollment of enrollments.rows) {
      try {
        await processEnrollment(client, enrollment);
        processedCount++;
      } catch (err) {
        logger.error('Error processing automation enrollment', {
          enrollmentId: enrollment.id,
          error: (err as Error).message,
        });
        // Continue with next enrollment
      }
    }

    if (processedCount > 0) {
      logger.info(`Automation processor: processed ${processedCount} enrollments`);
    }
  } finally {
    client.release();
  }
}

async function processEnrollment(
  client: import('pg').PoolClient,
  enrollment: Record<string, unknown>
): Promise<void> {
  const automationId = enrollment.automation_id as string;
  const contactId = enrollment.contact_id as string;
  const currentStep = enrollment.current_step as number;
  const enrollmentId = enrollment.id as string;
  const provider = enrollment.provider as string;

  // Load the current step
  const stepResult = await client.query(
    'SELECT * FROM automation_steps WHERE automation_id = $1 AND step_order = $2',
    [automationId, currentStep]
  );

  if (stepResult.rows.length === 0) {
    // No more steps — mark as completed
    await client.query(
      `UPDATE automation_enrollments
       SET status = 'completed', completed_at = NOW(), next_step_at = NULL
       WHERE id = $1`,
      [enrollmentId]
    );
    await client.query(
      `UPDATE automations
       SET total_completed = (SELECT COUNT(*) FROM automation_enrollments WHERE automation_id = $1 AND status = 'completed'),
           updated_at = NOW()
       WHERE id = $1`,
      [automationId]
    );
    return;
  }

  const step = stepResult.rows[0];

  if (!step.template_id) {
    // Step has no template — skip to next
    await advanceToNextStep(client, enrollmentId, automationId, currentStep);
    return;
  }

  // Load template
  const templateResult = await client.query('SELECT * FROM templates WHERE id = $1', [step.template_id]);
  if (templateResult.rows.length === 0) {
    logger.warn('Automation step template not found', { stepId: step.id, templateId: step.template_id });
    await advanceToNextStep(client, enrollmentId, automationId, currentStep);
    return;
  }
  const template = templateResult.rows[0];

  // Load contact
  const contactResult = await client.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
  if (contactResult.rows.length === 0) {
    // Contact deleted — cancel enrollment
    await client.query(
      "UPDATE automation_enrollments SET status = 'cancelled', next_step_at = NULL WHERE id = $1",
      [enrollmentId]
    );
    return;
  }
  const contact = contactResult.rows[0];

  // Check contact is active
  if (contact.status !== 'active') {
    await client.query(
      "UPDATE automation_enrollments SET status = 'cancelled', next_step_at = NULL WHERE id = $1",
      [enrollmentId]
    );
    return;
  }

  // Check suppression
  const suppressed = await isEmailSuppressed(contact.email);
  if (suppressed) {
    await client.query(
      "UPDATE automation_enrollments SET status = 'cancelled', next_step_at = NULL WHERE id = $1",
      [enrollmentId]
    );
    return;
  }

  // Check daily limit
  const limitCheck = await checkDailyLimit(provider);
  if (!limitCheck.allowed) {
    // Retry on next cycle — don't advance, don't cancel
    logger.warn('Automation send skipped: daily limit reached', { provider, enrollmentId });
    return;
  }

  // Resolve tracking domain + per-contact HMAC unsubscribe token. Automation
  // sends have no campaign_recipients row, so we can't use a tracking_token —
  // the HMAC token is stateless and stable per contact, so unsubscribe still
  // works without persisting anything extra per send.
  let trackingDomain: string;
  try {
    trackingDomain = await resolveTrackingDomain();
  } catch (e) {
    logger.error('Automation send skipped: tracking domain unresolved', {
      enrollmentId,
      error: (e as Error).message,
    });
    return;
  }
  const unsubToken = generateContactUnsubToken(contact.id);
  const unsubUrl = `${trackingDomain}/api/v1/t/u/${unsubToken}`;

  // Build variables and render
  const variables = buildContactVariables(contact);
  variables['unsubscribe_url'] = unsubUrl;
  const subject = step.subject_override || template.subject;
  const renderedSubject = renderTemplate(subject, variables);
  let renderedHtml = renderTemplate(template.html_body, variables);
  renderedHtml = ensureUnsubscribeFooter(renderedHtml, trackingDomain, unsubToken);
  const renderedText = template.text_body ? renderTemplate(template.text_body, variables) : undefined;

  // Load provider config
  const providerConfigResult = await client.query(
    "SELECT value FROM settings WHERE key = $1",
    [provider === 'gmail' ? 'gmail_config' : 'ses_config']
  );
  const providerConfig = providerConfigResult.rows[0]?.value || {};

  // Load reply-to setting
  const replyToResult = await client.query("SELECT value FROM settings WHERE key = 'reply_to'");
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

  // RFC 8058 one-click unsubscribe headers — required for bulk-sender
  // compliance with Gmail/Yahoo. Feedback-ID uses the 4-part form Google
  // expects: CampaignID:Customer:MailType:Sender (here CampaignID is the
  // automation id since there's no campaign).
  const fbCustomer = process.env.FEEDBACK_ID_CUSTOMER || 'thefoundersweb';
  const fbSender = process.env.FEEDBACK_ID_SENDER || 'cadencerelay';
  const headers: Record<string, string> = {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Feedback-ID': `${automationId}:${fbCustomer}:automation:${fbSender}`,
  };

  // Send email
  try {
    const emailProvider = createProvider(provider, providerConfig);
    await emailProvider.send({
      to: contact.email,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText || htmlToPlainText(renderedHtml),
      replyTo,
      headers,
    });

    // Increment daily counter
    await incrementDailySend(provider);

    // Update contact send stats
    await client.query(
      'UPDATE contacts SET send_count = send_count + 1, last_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [contactId]
    );

    // Advance to next step
    await advanceToNextStep(client, enrollmentId, automationId, currentStep);
  } catch (sendErr) {
    logger.error('Automation email send failed', {
      enrollmentId,
      contactEmail: contact.email,
      error: (sendErr as Error).message,
    });
    // Leave enrollment as-is to retry on next cycle
  }
}

async function advanceToNextStep(
  client: import('pg').PoolClient,
  enrollmentId: string,
  automationId: string,
  currentStep: number
): Promise<void> {
  const nextStepOrder = currentStep + 1;

  // Check if next step exists
  const nextStepResult = await client.query(
    'SELECT delay_days, delay_hours, delay_minutes FROM automation_steps WHERE automation_id = $1 AND step_order = $2',
    [automationId, nextStepOrder]
  );

  if (nextStepResult.rows.length === 0) {
    // No more steps — mark completed
    await client.query(
      `UPDATE automation_enrollments
       SET status = 'completed', current_step = $2, completed_at = NOW(),
           last_step_sent_at = NOW(), next_step_at = NULL
       WHERE id = $1`,
      [enrollmentId, nextStepOrder]
    );
    await client.query(
      `UPDATE automations
       SET total_completed = (SELECT COUNT(*) FROM automation_enrollments WHERE automation_id = $1 AND status = 'completed'),
           updated_at = NOW()
       WHERE id = $1`,
      [automationId]
    );
  } else {
    // Calculate delay for next step
    const nextStep = nextStepResult.rows[0];
    const delayMs = (nextStep.delay_days * 86400 + nextStep.delay_hours * 3600 + nextStep.delay_minutes * 60) * 1000;

    await client.query(
      `UPDATE automation_enrollments
       SET current_step = $2, last_step_sent_at = NOW(),
           next_step_at = NOW() + INTERVAL '1 millisecond' * $3
       WHERE id = $1`,
      [enrollmentId, nextStepOrder, delayMs]
    );
  }
}

/**
 * Fire automation triggers — called from contacts, lists, and tracking controllers.
 * Uses fire-and-forget pattern to avoid blocking the main flow.
 */
export async function fireAutomationTrigger(
  triggerType: string,
  contactId: string | string[],
  context?: Record<string, string>
): Promise<void> {
  try {
    // Find active automations matching this trigger type
    const automations = await pool.query(
      "SELECT id, trigger_config FROM automations WHERE status = 'active' AND trigger_type = $1",
      [triggerType]
    );

    if (automations.rows.length === 0) return;

    const contactIds = Array.isArray(contactId) ? contactId : [contactId];

    for (const auto of automations.rows) {
      const config = auto.trigger_config || {};

      // Filter by context: if automation has a specific campaignId/listId, only match that
      if (config.campaignId && context?.campaignId && config.campaignId !== context.campaignId) {
        continue; // This automation is for a different campaign
      }
      if (config.listId && context?.listId && config.listId !== context.listId) {
        continue; // This automation is for a different list
      }
      // Get step 0 delay
      const step0 = await pool.query(
        'SELECT delay_days, delay_hours, delay_minutes FROM automation_steps WHERE automation_id = $1 AND step_order = 0',
        [auto.id]
      );
      const delayMs = step0.rows[0]
        ? (step0.rows[0].delay_days * 86400 + step0.rows[0].delay_hours * 3600 + step0.rows[0].delay_minutes * 60) * 1000
        : 0;

      for (const cId of contactIds) {
        await pool.query(
          `INSERT INTO automation_enrollments (automation_id, contact_id, current_step, status, next_step_at)
           VALUES ($1, $2, 0, 'active', NOW() + INTERVAL '1 millisecond' * $3)
           ON CONFLICT (automation_id, contact_id) DO NOTHING`,
          [auto.id, cId, delayMs]
        );
      }

      // Update total_enrolled
      await pool.query(
        'UPDATE automations SET total_enrolled = (SELECT COUNT(*) FROM automation_enrollments WHERE automation_id = $1), updated_at = NOW() WHERE id = $1',
        [auto.id]
      );
    }
  } catch (err) {
    logger.error('fireAutomationTrigger error', { triggerType, error: (err as Error).message });
  }
}
