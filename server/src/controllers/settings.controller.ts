import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import dns from 'dns';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { cacheThrough, cacheDel } from '../utils/cache';
import { encryptCredential, decryptCredential, isEncrypted } from '../utils/crypto';
import { logger } from '../utils/logger';
import { SESClient, GetSendQuotaCommand, GetSendStatisticsCommand, SetIdentityNotificationTopicCommand, GetIdentityNotificationAttributesCommand } from '@aws-sdk/client-ses';
import { SNSClient, CreateTopicCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { resolveTrackingDomain } from '../utils/trackingDomain';

const dnsPromises = dns.promises;

// FIX: Mask sensitive fields so credentials are never returned in plaintext
const SENSITIVE_KEYS = ['pass', 'password', 'secretAccessKey', 'secret', 'accessKeyId'];

function maskSensitiveValues(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    try {
      const parsed = JSON.parse(obj);
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(maskSensitiveValues(parsed));
      }
    } catch {
      // not JSON, return as-is
    }
    return obj;
  }
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveValues);
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.includes(key) && typeof value === 'string' && value.length > 0) {
      masked[key] = value.length > 4 ? '****' + value.slice(-4) : '****';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveValues(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export async function getSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await cacheThrough<Record<string, unknown>>('settings', async () => {
      const result = await pool.query('SELECT key, value FROM settings ORDER BY key');
      const s: Record<string, unknown> = {};
      for (const row of result.rows) {
        let value = row.value;
        // pg returns jsonb as object, varchar/text as string
        if (typeof value === 'object' && value !== null) {
          value = maskSensitiveValues(value);
        } else if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null) {
              value = maskSensitiveValues(parsed);
            }
          } catch {
            // not JSON, keep as-is
          }
        }
        s[row.key] = value;
      }
      return s;
    }, 60);

    // Disable ETag/304 for settings — stale 304 responses cause saved values to appear lost
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('ETag', `W/"${Date.now()}"`);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

export async function updateProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { provider } = req.body;
    if (!['gmail', 'ses'].includes(provider)) {
      throw new AppError('Provider must be "gmail" or "ses"', 400);
    }

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(provider), 'email_provider']
    );

    await cacheDel('settings');
    res.json({ message: 'Provider updated', provider });
  } catch (err) {
    next(err);
  }
}

export async function updateGmailConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { host, port, user, pass } = req.body;

    // Load existing config to preserve unchanged encrypted password
    const existingResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_config'");
    let existingConfig: Record<string, string> = {};
    if (existingResult.rows[0]?.value) {
      existingConfig = typeof existingResult.rows[0].value === 'string'
        ? JSON.parse(existingResult.rows[0].value)
        : existingResult.rows[0].value;
    }

    // Only encrypt NEW password — if masked (****), keep existing encrypted value
    const isMasked = (val: string) => val && val.startsWith('****');
    const finalPass = !pass || isMasked(pass)
      ? existingConfig.pass || ''
      : encryptCredential(pass);

    const config = { host: host || 'smtp.gmail.com', port: port || 587, user, pass: finalPass };

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(config), 'gmail_config']
    );

    await cacheDel('settings');
    res.json({ message: 'Gmail config updated' });
  } catch (err) {
    next(err);
  }
}

export async function updateSesConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { region, accessKeyId, secretAccessKey, fromEmail, fromName } = req.body;
    logger.info('SES config update request', { hasFromName: !!fromName, fromNameValue: fromName, bodyKeys: Object.keys(req.body) });

    // Load existing config to preserve unchanged encrypted fields
    const existingResult = await pool.query("SELECT value FROM settings WHERE key = 'ses_config'");
    let existingConfig: Record<string, string> = {};
    if (existingResult.rows[0]?.value) {
      existingConfig = typeof existingResult.rows[0].value === 'string'
        ? JSON.parse(existingResult.rows[0].value)
        : existingResult.rows[0].value;
    }

    // Only encrypt NEW values — if user didn't change the field (masked value starts with ****), keep existing encrypted value
    const isMasked = (val: string) => val && val.startsWith('****');

    const finalAccessKeyId = !accessKeyId || isMasked(accessKeyId)
      ? existingConfig.accessKeyId || ''
      : encryptCredential(accessKeyId);

    const finalSecretAccessKey = !secretAccessKey || isMasked(secretAccessKey)
      ? existingConfig.secretAccessKey || ''
      : encryptCredential(secretAccessKey);

    // Preserve existing fromName if user didn't change it (sent as empty)
    const finalFromName = fromName || existingConfig.fromName || '';
    const config = { region, accessKeyId: finalAccessKeyId, secretAccessKey: finalSecretAccessKey, fromEmail, fromName: finalFromName };

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(config), 'ses_config']
    );

    await cacheDel('settings');
    res.json({ message: 'SES config updated' });
  } catch (err) {
    next(err);
  }
}

export async function updateThrottleDefaults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { perSecond, perHour } = req.body;
    const config = { perSecond, perHour };

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(config), 'throttle_defaults']
    );

    await cacheDel('settings');
    res.json({ message: 'Throttle defaults updated' });
  } catch (err) {
    next(err);
  }
}

export async function updateReplyTo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { replyTo } = req.body;
    // Allow empty string to clear the setting
    const value = replyTo || '';

    const exists = await pool.query("SELECT 1 FROM settings WHERE key = 'reply_to'");
    if (exists.rows.length > 0) {
      await pool.query(
        "UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'reply_to'",
        [JSON.stringify(value)]
      );
    } else {
      await pool.query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('reply_to', $1, NOW())",
        [JSON.stringify(value)]
      );
    }

    await cacheDel('settings');
    res.json({ message: 'Reply-To updated', replyTo: value });
  } catch (err) {
    next(err);
  }
}

export async function updateDailyLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { gmailDailyLimit, sesDailyLimit } = req.body;

    // Upsert gmail_daily_limit
    const gmailExists = await pool.query("SELECT 1 FROM settings WHERE key = 'gmail_daily_limit'");
    if (gmailExists.rows.length > 0) {
      await pool.query("UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'gmail_daily_limit'", [JSON.stringify(gmailDailyLimit)]);
    } else {
      await pool.query("INSERT INTO settings (key, value) VALUES ('gmail_daily_limit', $1)", [JSON.stringify(gmailDailyLimit)]);
    }

    // Upsert ses_daily_limit
    const sesExists = await pool.query("SELECT 1 FROM settings WHERE key = 'ses_daily_limit'");
    if (sesExists.rows.length > 0) {
      await pool.query("UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'ses_daily_limit'", [JSON.stringify(sesDailyLimit)]);
    } else {
      await pool.query("INSERT INTO settings (key, value) VALUES ('ses_daily_limit', $1)", [JSON.stringify(sesDailyLimit)]);
    }

    await cacheDel('settings');
    res.json({ message: 'Daily limits updated', gmailDailyLimit, sesDailyLimit });
  } catch (err) {
    next(err);
  }
}

export async function testEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { to, subject, html, campaignId, emailAccountId } = req.body;
    if (!to) {
      throw new AppError('Recipient email required', 400);
    }

    let provider: string;
    let parsedConfig: Record<string, unknown>;

    // If emailAccountId is provided, use that account's config (for campaign test emails)
    if (emailAccountId) {
      const acctResult = await pool.query('SELECT provider_type, config FROM email_accounts WHERE id = $1 AND is_active = true', [emailAccountId]);
      if (acctResult.rows.length === 0) {
        throw new AppError('Email account not found or inactive', 404);
      }
      provider = acctResult.rows[0].provider_type;
      parsedConfig = typeof acctResult.rows[0].config === 'string'
        ? JSON.parse(acctResult.rows[0].config) : acctResult.rows[0].config;
    } else {
      // Fall back to global provider setting
      const providerResult = await pool.query("SELECT value FROM settings WHERE key = 'email_provider'");
      const rawProvider = providerResult.rows[0]?.value || 'ses';
      provider = typeof rawProvider === 'string' && rawProvider.startsWith('"') ? JSON.parse(rawProvider) : rawProvider;

      const configKey = provider === 'gmail' ? 'gmail_config' : 'ses_config';
      const configResult = await pool.query('SELECT value FROM settings WHERE key = $1', [configKey]);
      const providerConfig = configResult.rows[0]?.value;

      if (!providerConfig) {
        throw new AppError(`Email provider "${provider}" is not configured. Please update ${provider === 'gmail' ? 'Gmail' : 'SES'} settings first.`, 400);
      }

      try {
        parsedConfig = typeof providerConfig === 'string' ? JSON.parse(providerConfig) : providerConfig;
      } catch {
        throw new AppError(`Email provider "${provider}" configuration is invalid. Please reconfigure settings.`, 400);
      }
    }

    if (provider === 'gmail') {
      if (!parsedConfig.user || !parsedConfig.pass) {
        throw new AppError('Gmail configuration is incomplete: "user" and "pass" are required.', 400);
      }
    } else {
      if (!parsedConfig.region || !parsedConfig.accessKeyId || !parsedConfig.secretAccessKey) {
        throw new AppError('SES configuration is incomplete: "region", "accessKeyId", and "secretAccessKey" are required.', 400);
      }
      if (!parsedConfig.fromEmail) {
        throw new AppError('SES configuration is incomplete: "fromEmail" is required.', 400);
      }
    }

    // Load reply_to setting
    const replyToResult = await pool.query("SELECT value FROM settings WHERE key = 'reply_to'");
    let replyTo: string | undefined;
    if (replyToResult.rows[0]?.value) {
      const raw = replyToResult.rows[0].value;
      // pg returns jsonb as already-parsed value — could be string directly or JSON-encoded string
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

    // Import and use provider factory
    const { createProvider } = await import('../services/email/providerFactory');
    const emailProvider = createProvider(provider, parsedConfig);

    const { htmlToPlainText } = await import('../utils/templateRenderer');
    const emailSubject = subject || 'Test Email from CadenceRelay';
    const emailHtml = html || '<h1>Test Email</h1><p>If you received this, your email provider is configured correctly.</p>';
    const emailText = htmlToPlainText(emailHtml);

    // Load attachments from campaign if campaignId is provided
    let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined;
    if (campaignId) {
      try {
        const campaignResult = await pool.query('SELECT attachments FROM campaigns WHERE id = $1', [campaignId]);
        const campaignAttachments = campaignResult.rows[0]?.attachments || [];
        if (Array.isArray(campaignAttachments) && campaignAttachments.length > 0) {
          attachments = [];
          for (const att of campaignAttachments) {
            if (att.storagePath && fs.existsSync(att.storagePath)) {
              attachments.push({
                filename: att.filename,
                content: fs.readFileSync(att.storagePath),
                contentType: att.contentType || 'application/octet-stream',
              });
            } else {
              logger.warn(`Test email: attachment file not found: ${att.storagePath}`);
            }
          }
          if (attachments.length === 0) attachments = undefined;
        }
      } catch (err) {
        logger.warn('Test email: failed to load campaign attachments', { error: (err as Error).message });
      }
    }

    // Add List-Unsubscribe headers for deliverability (even on test emails)
    let trackingDomainVal = '';
    try {
      trackingDomainVal = await resolveTrackingDomain();
    } catch {
      // dev / unconfigured env — skip List-Unsubscribe rather than fail the test send
    }
    const unsubHeaders: Record<string, string> = {};
    if (trackingDomainVal && !trackingDomainVal.startsWith('http://localhost')) {
      const testUnsubUrl = `${trackingDomainVal}/api/v1/t/u/test-${Date.now()}`;
      unsubHeaders['List-Unsubscribe'] = `<${testUnsubUrl}>`;
      unsubHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    await emailProvider.send({
      to,
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
      replyTo,
      headers: unsubHeaders,
      attachments,
    });

    res.json({ message: `Test email sent to ${to} via ${provider}` });
  } catch (err) {
    next(err);
  }
}

// ─── Domain Health / Deliverability Dashboard ───────────────────────────────

/** Run a DNS query with a 5-second timeout. Returns null on any error. */
async function dnsWithTimeout<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 5000)),
    ]);
    return result;
  } catch {
    return null;
  }
}

type CheckStatus = 'pass' | 'warning' | 'fail' | 'info' | 'unknown';
interface DnsCheck {
  status: CheckStatus;
  message: string;
  record?: string;
  recommendation?: string;
}

async function checkSpf(domain: string): Promise<DnsCheck> {
  const records = await dnsWithTimeout(() => dnsPromises.resolveTxt(domain));
  if (!records) {
    return { status: 'unknown', message: 'Could not query SPF (DNS timeout or error)' };
  }
  // TXT records come back as arrays of chunks; join each record
  for (const chunks of records) {
    const txt = chunks.join('');
    if (txt.includes('v=spf1')) {
      if (txt.includes('include:amazonses.com')) {
        return { status: 'pass', message: 'SPF configured with SES', record: txt };
      }
      if (txt.includes('include:_spf.google.com') || txt.includes('include:google.com')) {
        return { status: 'pass', message: 'SPF configured with Google', record: txt };
      }
      return { status: 'warning', message: 'SPF found but may not include your email provider', record: txt };
    }
  }
  return {
    status: 'fail',
    message: 'No SPF record found',
    recommendation: `Add TXT record: ${domain} -> "v=spf1 include:amazonses.com ~all"`,
  };
}

async function checkDkim(domain: string): Promise<DnsCheck> {
  const selectors = ['google', 'default', 's1', 's2', 'selector1', 'selector2', 'k1'];
  for (const sel of selectors) {
    const host = `${sel}._domainkey.${domain}`;
    const txt = await dnsWithTimeout(() => dnsPromises.resolveTxt(host));
    if (txt && txt.length > 0) {
      return { status: 'pass', message: `DKIM found (selector: ${sel})`, record: txt[0].join('') };
    }
    const cname = await dnsWithTimeout(() => dnsPromises.resolveCname(host));
    if (cname && cname.length > 0) {
      return { status: 'pass', message: `DKIM found via CNAME (selector: ${sel})`, record: cname[0] };
    }
  }
  // Also try the bare _domainkey subdomain
  const bare = await dnsWithTimeout(() => dnsPromises.resolveTxt(`_domainkey.${domain}`));
  if (bare && bare.length > 0) {
    return { status: 'pass', message: 'DKIM records found', record: bare[0].join('') };
  }
  return {
    status: 'warning',
    message: 'Could not verify DKIM (may still be configured via provider)',
  };
}

async function checkDmarc(domain: string): Promise<DnsCheck> {
  const records = await dnsWithTimeout(() => dnsPromises.resolveTxt(`_dmarc.${domain}`));
  if (!records) {
    return { status: 'unknown', message: 'Could not query DMARC (DNS timeout or error)' };
  }
  for (const chunks of records) {
    const txt = chunks.join('');
    if (txt.includes('v=DMARC1')) {
      if (txt.includes('p=reject') || txt.includes('p=quarantine')) {
        return { status: 'pass', message: 'DMARC enforced', record: txt };
      }
      if (txt.includes('p=none')) {
        return {
          status: 'warning',
          message: 'DMARC in monitoring mode (p=none). Upgrade to p=quarantine for better deliverability',
          record: txt,
        };
      }
      return { status: 'pass', message: 'DMARC configured', record: txt };
    }
  }
  return {
    status: 'fail',
    message: 'No DMARC record found',
    recommendation: `Add TXT record: _dmarc.${domain} -> "v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}"`,
  };
}

async function checkMx(domain: string): Promise<DnsCheck> {
  const records = await dnsWithTimeout(() => dnsPromises.resolveMx(domain));
  if (!records) {
    return { status: 'unknown', message: 'Could not query MX records (DNS timeout or error)' };
  }
  if (records.length > 0) {
    return { status: 'pass', message: `MX records found (${records.length})` };
  }
  return { status: 'info', message: 'No MX records (domain cannot receive replies)' };
}

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export async function getDomainHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Extract the sending domain from settings
    const providerResult = await pool.query("SELECT value FROM settings WHERE key = 'email_provider'");
    const activeProvider: string = providerResult.rows[0]?.value || 'ses';

    let domain = '';
    if (activeProvider === 'ses') {
      const sesResult = await pool.query("SELECT value FROM settings WHERE key = 'ses_config'");
      const sesConfig = sesResult.rows[0]?.value;
      if (sesConfig) {
        const parsed = typeof sesConfig === 'string' ? JSON.parse(sesConfig) : sesConfig;
        if (parsed.fromEmail) {
          domain = parsed.fromEmail.split('@')[1] || '';
        }
      }
    } else {
      const gmailResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_config'");
      const gmailConfig = gmailResult.rows[0]?.value;
      if (gmailConfig) {
        const parsed = typeof gmailConfig === 'string' ? JSON.parse(gmailConfig) : gmailConfig;
        if (parsed.user) {
          domain = parsed.user.split('@')[1] || '';
        }
      }
    }

    if (!domain) {
      res.json({
        domain: '',
        healthScore: 0,
        grade: 'N/A',
        checks: {
          spf: { status: 'unknown', message: 'No sending domain configured' },
          dkim: { status: 'unknown', message: 'No sending domain configured' },
          dmarc: { status: 'unknown', message: 'No sending domain configured' },
          mx: { status: 'unknown', message: 'No sending domain configured' },
        },
        metrics: { sent30d: 0, bounceRate: 0, complaintRate: 0, unsubRate: 0, bounceRateGrade: 'good', complaintRateGrade: 'good' },
        recommendations: ['Configure an email provider to enable domain health checks'],
      });
      return;
    }

    // 2. Run DNS checks in parallel
    const [spf, dkim, dmarc, mx] = await Promise.all([
      checkSpf(domain),
      checkDkim(domain),
      checkDmarc(domain),
      checkMx(domain),
    ]);

    // 3. Deliverability metrics from database (last 30 days)
    const metricsResult = await pool.query(
      `SELECT
        COALESCE(SUM(sent_count), 0) as sent,
        COALESCE(SUM(bounce_count), 0) as bounced,
        COALESCE(SUM(complaint_count), 0) as complaints,
        COALESCE(SUM(unsubscribe_count), 0) as unsubs
       FROM campaigns
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    );
    const m = metricsResult.rows[0];
    const sent30d = Number(m.sent) || 0;
    const bounceRate = sent30d > 0 ? (Number(m.bounced) / sent30d) * 100 : 0;
    const complaintRate = sent30d > 0 ? (Number(m.complaints) / sent30d) * 100 : 0;
    const unsubRate = sent30d > 0 ? (Number(m.unsubs) / sent30d) * 100 : 0;

    const bounceRateGrade = bounceRate < 2 ? 'good' : bounceRate < 5 ? 'warning' : 'bad';
    const complaintRateGrade = complaintRate < 0.1 ? 'good' : complaintRate < 0.3 ? 'warning' : 'bad';

    // 4. Calculate health score (0-100)
    let healthScore = 0;
    // SPF: pass +25, warning +10
    if (spf.status === 'pass') healthScore += 25;
    else if (spf.status === 'warning') healthScore += 10;
    // DKIM: pass +25, warning +15
    if (dkim.status === 'pass') healthScore += 25;
    else if (dkim.status === 'warning') healthScore += 15;
    // DMARC: pass +20, warning +10
    if (dmarc.status === 'pass') healthScore += 20;
    else if (dmarc.status === 'warning') healthScore += 10;
    // Bounce rate: <2% +15, <5% +10
    if (bounceRate < 2) healthScore += 15;
    else if (bounceRate < 5) healthScore += 10;
    // Complaint rate: <0.1% +15, <0.3% +10
    if (complaintRate < 0.1) healthScore += 15;
    else if (complaintRate < 0.3) healthScore += 10;

    const grade = gradeFromScore(healthScore);

    // 5. Recommendations
    const recommendations: string[] = [];
    if (spf.status === 'fail') recommendations.push('Add an SPF record to authenticate your sending domain');
    if (spf.status === 'warning') recommendations.push('Update your SPF record to include your email provider');
    if (dkim.status === 'warning' || dkim.status === 'fail') recommendations.push('Configure DKIM signing for your domain');
    if (dmarc.status === 'fail' && dmarc.recommendation) recommendations.push(`Add a DMARC record: ${dmarc.recommendation}`);
    if (dmarc.status === 'warning') recommendations.push('Upgrade DMARC policy from p=none to p=quarantine for better deliverability');
    if (bounceRateGrade === 'good') recommendations.push('Your bounce rate is excellent -- keep it under 2%');
    if (bounceRateGrade === 'warning') recommendations.push('Bounce rate is elevated (2-5%). Clean your contact list to remove invalid addresses');
    if (bounceRateGrade === 'bad') recommendations.push('Bounce rate is critical (>5%). Immediately clean your contact list and check for list quality issues');
    if (complaintRateGrade === 'warning') recommendations.push('Complaint rate is elevated. Review your content and sending frequency');
    if (complaintRateGrade === 'bad') recommendations.push('Complaint rate is critical (>0.3%). This risks your domain being blacklisted');
    if (sent30d === 0) recommendations.push('No emails sent in the last 30 days -- send a campaign to see deliverability metrics');

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      domain,
      healthScore,
      grade,
      checks: { spf, dkim, dmarc, mx },
      metrics: {
        sent30d,
        bounceRate: Math.round(bounceRate * 100) / 100,
        complaintRate: Math.round(complaintRate * 1000) / 1000,
        unsubRate: Math.round(unsubRate * 100) / 100,
        bounceRateGrade,
        complaintRateGrade,
      },
      recommendations,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Helper: decrypt credential if encrypted (same as providerFactory) ────────

function maybeDecrypt(value: string): string {
  if (!value) return value;
  let current = value;
  for (let i = 0; i < 5; i++) {
    if (!isEncrypted(current)) break;
    const decrypted = decryptCredential(current);
    if (decrypted === null) break;
    current = decrypted;
  }
  return current;
}

/** Load SES config from settings and create an SESClient with decrypted credentials */
async function loadSesClient(): Promise<{ client: SESClient; snsClient: SNSClient; region: string; fromEmail: string }> {
  const sesResult = await pool.query("SELECT value FROM settings WHERE key = 'ses_config'");
  const sesConfig = sesResult.rows[0]?.value;
  if (!sesConfig) {
    throw new AppError('SES is not configured. Please set up SES credentials first.', 400);
  }
  const parsed = typeof sesConfig === 'string' ? JSON.parse(sesConfig) : sesConfig;
  if (!parsed.region || !parsed.accessKeyId || !parsed.secretAccessKey) {
    throw new AppError('SES configuration is incomplete: region, accessKeyId, and secretAccessKey are required.', 400);
  }
  const credentials = {
    accessKeyId: maybeDecrypt(parsed.accessKeyId),
    secretAccessKey: maybeDecrypt(parsed.secretAccessKey),
  };
  const client = new SESClient({ region: parsed.region, credentials });
  const snsClient = new SNSClient({ region: parsed.region, credentials });
  return { client, snsClient, region: parsed.region, fromEmail: parsed.fromEmail || '' };
}

// ─── SES Quota Endpoint ───────────────────────────────────────────────────────

export async function getSesQuota(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { client } = await loadSesClient();

    const [quotaResp, statsResp] = await Promise.all([
      client.send(new GetSendQuotaCommand({})),
      client.send(new GetSendStatisticsCommand({})),
    ]);

    const max24HourSend = quotaResp.Max24HourSend || 0;
    const sentLast24Hours = quotaResp.SentLast24Hours || 0;
    const maxSendRate = quotaResp.MaxSendRate || 0;
    const remaining = max24HourSend - sentLast24Hours;
    const usagePercent = max24HourSend > 0 ? Math.round((sentLast24Hours / max24HourSend) * 1000) / 10 : 0;
    const sandbox = max24HourSend <= 200 && sentLast24Hours <= 200;

    // Recent send statistics (last few data points)
    const recentStats = (statsResp.SendDataPoints || [])
      .sort((a, b) => {
        const ta = a.Timestamp?.getTime() || 0;
        const tb = b.Timestamp?.getTime() || 0;
        return tb - ta;
      })
      .slice(0, 10)
      .map(dp => ({
        timestamp: dp.Timestamp?.toISOString(),
        deliveryAttempts: dp.DeliveryAttempts || 0,
        bounces: dp.Bounces || 0,
        complaints: dp.Complaints || 0,
        rejects: dp.Rejects || 0,
      }));

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      max24HourSend,
      sentLast24Hours,
      maxSendRate,
      remaining,
      usagePercent,
      sandbox,
      recentStats,
    });
  } catch (err) {
    const error = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    if (error.name === 'AccessDeniedException' || error.name === 'AccessDenied') {
      next(new AppError('Missing IAM permission: ses:GetSendQuota. Please add this permission to your IAM user.', 403));
      return;
    }
    next(err);
  }
}

// ─── SNS Bounce Setup Endpoint ────────────────────────────────────────────────

export async function setupSns(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { client, snsClient, fromEmail } = await loadSesClient();

    if (!fromEmail) {
      throw new AppError('SES fromEmail is not configured. Please set a From Email in SES settings first.', 400);
    }

    // Load tracking domain for the webhook endpoint (env-authoritative).
    let trackingDomain: string;
    try {
      trackingDomain = await resolveTrackingDomain();
    } catch (e) {
      throw new AppError(`Tracking domain misconfigured: ${(e as Error).message}`, 500);
    }
    if (trackingDomain.startsWith('http://localhost')) {
      throw new AppError('A public tracking domain is required for SNS webhook subscriptions. Please set TRACKING_DOMAIN to a public https URL.', 400);
    }

    // 1. Create SNS topic (idempotent)
    let topicArn: string;
    try {
      const topicResp = await snsClient.send(new CreateTopicCommand({ Name: 'cadencerelay-notifications' }));
      topicArn = topicResp.TopicArn || '';
      if (!topicArn) throw new Error('No topic ARN returned');
    } catch (err) {
      const error = err as { name?: string; message?: string };
      if (error.name === 'AuthorizationErrorException' || error.name === 'AccessDeniedException') {
        throw new AppError('Missing IAM permission: sns:CreateTopic. Please add this permission to your IAM user.', 403);
      }
      throw err;
    }

    // 2. Subscribe our webhook endpoint (idempotent — SNS deduplicates same topic+protocol+endpoint)
    // Ensure HTTPS — SNS requires endpoint protocol to match subscription protocol
    const baseUrl = trackingDomain.replace(/^http:\/\//i, 'https://');
    const webhookUrl = `${baseUrl}/api/v1/webhooks/sns`;
    try {
      await snsClient.send(new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'https',
        Endpoint: webhookUrl,
      }));
    } catch (err) {
      const error = err as { name?: string; message?: string };
      if (error.name === 'AuthorizationErrorException' || error.name === 'AccessDeniedException') {
        throw new AppError('Missing IAM permission: sns:Subscribe. Please add this permission to your IAM user.', 403);
      }
      throw err;
    }

    // 3. Configure SES to send bounces and complaints to the SNS topic
    // Try domain first, then fall back to full email address as the SES identity
    const domain = fromEmail.includes('@') ? fromEmail.split('@')[1] : fromEmail;
    let identity = domain;

    const setNotifications = async (id: string) => {
      await Promise.all([
        client.send(new SetIdentityNotificationTopicCommand({
          Identity: id,
          NotificationType: 'Bounce',
          SnsTopic: topicArn,
        })),
        client.send(new SetIdentityNotificationTopicCommand({
          Identity: id,
          NotificationType: 'Complaint',
          SnsTopic: topicArn,
        })),
      ]);
    };

    try {
      await setNotifications(domain);
      identity = domain;
    } catch (domainErr) {
      // Domain not verified — try the full email address as identity
      try {
        await setNotifications(fromEmail);
        identity = fromEmail;
      } catch (emailErr) {
        const error = emailErr as { name?: string; message?: string };
        if (error.name === 'AccessDeniedException' || error.name === 'AccessDenied') {
          throw new AppError('Missing IAM permission: ses:SetIdentityNotificationTopic. Please add this permission to your IAM user.', 403);
        }
        throw new AppError(
          `Neither domain "${domain}" nor email "${fromEmail}" is a verified SES identity. Please verify your sending domain or email in the AWS SES console.`,
          400
        );
      }
    }

    logger.info('SNS bounce/complaint setup completed', { topicArn, identity, webhookUrl });

    res.json({
      message: 'SNS bounce and complaint notifications configured successfully',
      topicArn,
      identity,
      webhookUrl,
    });
  } catch (err) {
    next(err);
  }
}

// ─── SNS Status Endpoint ──────────────────────────────────────────────────────

export async function getSnsStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { client, fromEmail } = await loadSesClient();

    if (!fromEmail) {
      res.json({ configured: false, message: 'No SES fromEmail configured' });
      return;
    }

    // Check both domain and full email — SNS could be configured on either
    const domain = fromEmail.includes('@') ? fromEmail.split('@')[1] : fromEmail;
    const identitiesToCheck = domain !== fromEmail ? [domain, fromEmail] : [fromEmail];

    try {
      const resp = await client.send(new GetIdentityNotificationAttributesCommand({
        Identities: identitiesToCheck,
      }));

      // Find the first identity that has notification attributes configured
      let identity = identitiesToCheck[0];
      let attrs = resp.NotificationAttributes?.[identitiesToCheck[0]];
      for (const id of identitiesToCheck) {
        const a = resp.NotificationAttributes?.[id];
        if (a && (a.BounceTopic || a.ComplaintTopic)) {
          attrs = a;
          identity = id;
          break;
        }
      }

      if (!attrs || (!attrs.BounceTopic && !attrs.ComplaintTopic)) {
        res.json({ configured: false, identity, message: 'No notification attributes found for identity' });
        return;
      }

      const bounceTopicArn = attrs.BounceTopic || '';
      const complaintTopicArn = attrs.ComplaintTopic || '';
      const configured = !!(bounceTopicArn && complaintTopicArn);

      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json({
        configured,
        identity,
        bounceTopicArn,
        complaintTopicArn,
        headersInBounceNotificationsEnabled: attrs.HeadersInBounceNotificationsEnabled || false,
        headersInComplaintNotificationsEnabled: attrs.HeadersInComplaintNotificationsEnabled || false,
      });
    } catch (err) {
      const error = err as { name?: string; message?: string };
      if (error.name === 'AccessDeniedException' || error.name === 'AccessDenied') {
        next(new AppError('Missing IAM permission: ses:GetIdentityNotificationAttributes. Please add this permission to your IAM user.', 403));
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

// ─── SES Account Statistics Endpoint ─────────────────────────────────────────

export async function getSesStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { client } = await loadSesClient();

    const [quotaResp, statsResp] = await Promise.all([
      client.send(new GetSendQuotaCommand({})),
      client.send(new GetSendStatisticsCommand({})),
    ]);

    const dataPoints = (statsResp.SendDataPoints || [])
      .sort((a, b) => {
        const ta = a.Timestamp?.getTime() || 0;
        const tb = b.Timestamp?.getTime() || 0;
        return ta - tb;
      })
      .map(dp => ({
        timestamp: dp.Timestamp?.toISOString(),
        deliveryAttempts: dp.DeliveryAttempts || 0,
        bounces: dp.Bounces || 0,
        complaints: dp.Complaints || 0,
        rejects: dp.Rejects || 0,
      }));

    // Aggregate totals from all data points
    let totalDeliveryAttempts = 0;
    let totalBounces = 0;
    let totalComplaints = 0;
    let totalRejects = 0;
    for (const dp of dataPoints) {
      totalDeliveryAttempts += dp.deliveryAttempts;
      totalBounces += dp.bounces;
      totalComplaints += dp.complaints;
      totalRejects += dp.rejects;
    }

    // SES DeliveryAttempts = total sent, Delivered = sent - bounces - rejects
    const totalSent = totalDeliveryAttempts;
    const delivered = totalDeliveryAttempts - totalBounces - totalRejects;
    const deliveryRate = totalSent > 0
      ? Math.round((delivered / totalSent) * 1000) / 10
      : 0;
    const bounceRate = totalSent > 0
      ? Math.round((totalBounces / totalSent) * 1000) / 10
      : 0;
    const complaintRate = totalSent > 0
      ? Math.round((totalComplaints / totalSent) * 10000) / 100
      : 0;

    // Get bounce type breakdown + opens/clicks from our own database
    const ownStatsResult = await pool.query(
      `SELECT
        COALESCE(SUM(c.open_count), 0) as total_opens,
        COALESCE(SUM(c.click_count), 0) as total_clicks
       FROM campaigns c`
    );
    const bounceBreakdown = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE bounce_type = 'permanent') as permanent_bounces,
        COUNT(*) FILTER (WHERE bounce_type = 'transient') as transient_bounces,
        COUNT(*) FILTER (WHERE bounce_type = 'undetermined' OR (status IN ('bounced','failed') AND bounce_type IS NULL)) as undetermined_bounces
       FROM campaign_recipients`
    );
    const dbPermanent = Number(bounceBreakdown.rows[0]?.permanent_bounces || 0);
    const dbTransient = Number(bounceBreakdown.rows[0]?.transient_bounces || 0);
    const dbUndetermined = Number(bounceBreakdown.rows[0]?.undetermined_bounces || 0);

    // Use SES aggregate as source of truth for transient bounces
    // SES total bounces = permanent + transient (we know permanent from SES suppression list import)
    // So transient = SES total bounces - permanent (from our DB)
    const permanentBounces = dbPermanent;
    const transientBounces = Math.max(dbTransient, totalBounces - dbPermanent);
    const undeterminedBounces = dbUndetermined;

    const totalOpens = Number(ownStatsResult.rows[0]?.total_opens || 0);
    const totalClicks = Number(ownStatsResult.rows[0]?.total_clicks || 0);
    const openRate = delivered > 0
      ? Math.round((totalOpens / delivered) * 1000) / 10
      : 0;
    const clickRate = delivered > 0
      ? Math.round((totalClicks / delivered) * 1000) / 10
      : 0;

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      sent: totalSent,
      delivered,
      bounces: totalBounces,
      permanentBounces,
      transientBounces,
      undeterminedBounces,
      complaints: totalComplaints,
      rejects: totalRejects,
      opens: totalOpens,
      clicks: totalClicks,
      deliveryRate,
      bounceRate,
      permanentBounceRate: totalSent > 0 ? Math.round((permanentBounces / totalSent) * 1000) / 10 : 0,
      transientBounceRate: totalSent > 0 ? Math.round((transientBounces / totalSent) * 1000) / 10 : 0,
      complaintRate,
      openRate,
      clickRate,
      quota: {
        max24HourSend: quotaResp.Max24HourSend || 0,
        sentLast24Hours: quotaResp.SentLast24Hours || 0,
        maxSendRate: quotaResp.MaxSendRate || 0,
      },
      dataPoints,
    });
  } catch (err) {
    const error = err as { name?: string; message?: string };
    if (error.name === 'AccessDeniedException' || error.name === 'AccessDenied') {
      next(new AppError('Missing IAM permission: ses:GetSendStatistics. Please add this permission to your IAM user.', 403));
      return;
    }
    next(err);
  }
}

/**
 * Classify old unclassified bounced/failed recipients by analyzing error messages.
 * Also adds all permanent bounces to suppression list.
 */
export async function classifyAndImportBounces(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    let importedFromSes = 0;
    let permanentCount = 0;
    let transientCount = 0;
    let complaintEmails: string[] = [];

    // ── Step 0: Reset previous incorrect classifications to start fresh ──
    await pool.query(
      `UPDATE campaign_recipients SET bounce_type = NULL
       WHERE bounce_type IS NOT NULL AND status = 'sent'`
    );
    logger.info('Reset previous bounce classifications on sent records');

    // ── Step 1: Pull permanent bounces from SES Account Suppression List ──
    const sesEmails: string[] = [];
    try {
      const { SESv2Client, ListSuppressedDestinationsCommand } = await import('@aws-sdk/client-sesv2');

      const sesResult = await pool.query("SELECT value FROM settings WHERE key = 'ses_config'");
      const cfg = sesResult.rows[0]?.value;
      const parsed = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;

      const sesV2 = new SESv2Client({
        region: parsed.region,
        credentials: {
          accessKeyId: maybeDecrypt(parsed.accessKeyId),
          secretAccessKey: maybeDecrypt(parsed.secretAccessKey),
        },
      });

      // Fetch permanent bounces (Reason: BOUNCE)
      let nextToken: string | undefined;
      do {
        let resp;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            resp = await sesV2.send(new ListSuppressedDestinationsCommand({
              Reasons: ['BOUNCE'],
              NextToken: nextToken,
              PageSize: 100,
            }));
            break;
          } catch (retryErr) {
            const re = retryErr as { message?: string };
            if (re.message?.includes('Rate exceeded') && attempt < 4) {
              logger.info(`SES rate limited, retry ${attempt + 1}/5 after ${(attempt + 1) * 3}s`);
              await sleep(3000 * (attempt + 1));
              continue;
            }
            throw retryErr;
          }
        }
        if (!resp) break;

        for (const dest of resp.SuppressedDestinationSummaries || []) {
          if (dest.EmailAddress) sesEmails.push(dest.EmailAddress.toLowerCase());
        }
        nextToken = resp.NextToken;
        // Small delay between pages to avoid rate limiting
        if (nextToken) await sleep(500);
      } while (nextToken && sesEmails.length < 20000);

      logger.info(`Fetched ${sesEmails.length} permanent bounces from SES`);

      // Also fetch complaints
      complaintEmails = [];
      nextToken = undefined;
      do {
        let resp;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            resp = await sesV2.send(new ListSuppressedDestinationsCommand({
              Reasons: ['COMPLAINT'],
              NextToken: nextToken,
              PageSize: 100,
            }));
            break;
          } catch (retryErr) {
            const re = retryErr as { message?: string };
            if (re.message?.includes('Rate exceeded') && attempt < 4) {
              await sleep(3000 * (attempt + 1));
              continue;
            }
            throw retryErr;
          }
        }
        if (!resp) break;
        for (const dest of resp.SuppressedDestinationSummaries || []) {
          if (dest.EmailAddress) complaintEmails.push(dest.EmailAddress.toLowerCase());
        }
        nextToken = resp.NextToken;
        if (nextToken) await sleep(500);
      } while (nextToken && complaintEmails.length < 5000);

      logger.info(`Fetched ${complaintEmails.length} complaints from SES`);

      // Mark complaint contacts
      if (complaintEmails.length > 0) {
        for (let i = 0; i < complaintEmails.length; i += 500) {
          const batch = complaintEmails.slice(i, i + 500);
          await pool.query(
            `UPDATE contacts SET status = 'complained', updated_at = NOW() WHERE LOWER(email) = ANY($1) AND status != 'complained'`,
            [batch]
          );
        }
        // Add to suppression
        for (let i = 0; i < complaintEmails.length; i += 100) {
          const batch = complaintEmails.slice(i, i + 100);
          const vals = batch.map((_, idx) => `($${idx + 1}, 'ses_complaint', 'ses_import')`).join(', ');
          await pool.query(`INSERT INTO suppression_list (email, reason, added_by) VALUES ${vals} ON CONFLICT DO NOTHING`, batch);
        }
      }

      // Mark these as permanent bounces in campaign_recipients
      if (sesEmails.length > 0) {
        // Process in batches of 500
        for (let i = 0; i < sesEmails.length; i += 500) {
          const batch = sesEmails.slice(i, i + 500);
          const r = await pool.query(
            `UPDATE campaign_recipients SET bounce_type = 'permanent', status = 'bounced', bounced_at = COALESCE(bounced_at, NOW())
             WHERE LOWER(email) = ANY($1) AND bounce_type IS NULL`,
            [batch]
          );
          permanentCount += r.rowCount || 0;
        }

        // Add to suppression list
        for (let i = 0; i < sesEmails.length; i += 100) {
          const batch = sesEmails.slice(i, i + 100);
          const values: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          for (const email of batch) {
            values.push(`($${idx}, 'ses_permanent_bounce', 'ses_import')`);
            params.push(email);
            idx++;
          }
          const r = await pool.query(
            `INSERT INTO suppression_list (email, reason, added_by) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
            params
          );
          importedFromSes += r.rowCount || 0;
        }

        // Mark contacts as bounced
        for (let i = 0; i < sesEmails.length; i += 500) {
          const batch = sesEmails.slice(i, i + 500);
          await pool.query(
            `UPDATE contacts SET status = 'bounced', bounce_type = 'permanent', bounce_count = bounce_count + 1, updated_at = NOW()
             WHERE LOWER(email) = ANY($1) AND (status = 'active' OR bounce_type IS NULL)`,
            [batch]
          );
        }
      }
    } catch (sesErr) {
      const e = sesErr as { name?: string; message?: string };
      logger.warn('Could not fetch SES suppression list', { error: e.message });
    }

    // ── Step 2: Classify bounced/failed records from error messages ──
    const cp = await pool.query(
      `UPDATE campaign_recipients SET bounce_type = 'permanent'
       WHERE (status = 'bounced' OR status = 'failed') AND bounce_type IS NULL AND error_message IS NOT NULL
       AND error_message ~* '(5[0-9]{2}|does not exist|not found|invalid|rejected|no such user|mailbox not found|address rejected|user unknown|MessageRejected|permanently)'`
    );
    permanentCount += cp.rowCount || 0;

    const ct = await pool.query(
      `UPDATE campaign_recipients SET bounce_type = 'transient'
       WHERE (status = 'bounced' OR status = 'failed') AND bounce_type IS NULL AND error_message IS NOT NULL
       AND error_message ~* '(4[0-9]{2}|timeout|temporarily|try again|rate limit|connection|throttl|too many|mailbox full|over quota|service unavailable)'`
    );
    transientCount += ct.rowCount || 0;

    await pool.query(
      `UPDATE campaign_recipients SET bounce_type = 'undetermined'
       WHERE (status = 'bounced' OR status = 'failed') AND bounce_type IS NULL`
    );

    // ── Step 3: Do NOT guess transient bounces from open rates ──
    // We cannot determine per-email transient bounces — only SES knows which specific
    // emails got 4xx responses. The transient bounce COUNT is calculated from:
    // SES total bounces - permanent bounces = transient bounces
    // This is shown in the SES stats section, not per-recipient.
    //
    // What we CAN mark as transient: records that our worker explicitly classified as
    // transient during sending (SMTP 4xx, timeout, rate limit errors).
    // Those are already handled in Step 2 above.

    // ── Step 4: Add any new permanent bounces to suppression ──
    const sp = await pool.query(
      `INSERT INTO suppression_list (email, reason, added_by)
       SELECT DISTINCT email, 'permanent_bounce', 'auto_classify'
       FROM campaign_recipients WHERE bounce_type = 'permanent'
       ON CONFLICT DO NOTHING`
    );

    // ── Step 5: Update campaign bounce counts ──
    await pool.query(
      `UPDATE campaigns SET bounce_count = (
        SELECT COUNT(*) FROM campaign_recipients cr
        WHERE cr.campaign_id = campaigns.id AND cr.bounce_type = 'permanent'
      ), updated_at = NOW()
       WHERE id IN (SELECT DISTINCT campaign_id FROM campaign_recipients WHERE bounce_type = 'permanent')`
    );

    res.json({
      importedFromSes,
      classified: {
        permanent: permanentCount,
        transient: transientCount,
      },
      suppressed: (sp.rowCount || 0) + importedFromSes,
      sesEmailsFetched: sesEmails.length,
      sesComplaintsFetched: complaintEmails.length,
      message: `Fetched ${sesEmails.length} permanent bounces + ${complaintEmails.length} complaints from SES. ${permanentCount} marked permanent, ${transientCount} classified transient. ${(sp.rowCount || 0) + importedFromSes} added to suppression.`,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Bounced Emails Not in Suppression List ──────────────────────────────────

export async function getBouncedEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    // Count total bounced emails NOT in suppression list
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT cr.email) as count
       FROM campaign_recipients cr
       WHERE cr.status = 'bounced'
       AND LOWER(cr.email) NOT IN (SELECT LOWER(email) FROM suppression_list)`
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch paginated bounced emails with most recent bounce info
    const result = await pool.query(
      `SELECT cr.email, MAX(cr.bounced_at) as bounced_at, MAX(cr.error_message) as error_message,
              COUNT(*) as bounce_count
       FROM campaign_recipients cr
       WHERE cr.status = 'bounced'
       AND LOWER(cr.email) NOT IN (SELECT LOWER(email) FROM suppression_list)
       GROUP BY cr.email
       ORDER BY MAX(cr.bounced_at) DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      data: result.rows,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}
