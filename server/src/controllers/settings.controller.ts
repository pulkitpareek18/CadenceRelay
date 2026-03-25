import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { cacheThrough, cacheDel } from '../utils/cache';
import { encryptCredential, decryptCredential, isEncrypted } from '../utils/crypto';

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

    const config = { region, accessKeyId: finalAccessKeyId, secretAccessKey: finalSecretAccessKey, fromEmail, fromName: fromName || '' };

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

export async function testEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { to, subject, html } = req.body;
    if (!to) {
      throw new AppError('Recipient email required', 400);
    }

    // Get current provider
    const providerResult = await pool.query("SELECT value FROM settings WHERE key = 'email_provider'");
    const provider = providerResult.rows[0]?.value || 'ses';

    // Get provider config
    const configKey = provider === 'gmail' ? 'gmail_config' : 'ses_config';
    const configResult = await pool.query('SELECT value FROM settings WHERE key = $1', [configKey]);
    const providerConfig = configResult.rows[0]?.value;

    // FIX: Better error messages when provider config is incomplete
    if (!providerConfig) {
      throw new AppError(`Email provider "${provider}" is not configured. Please update ${provider === 'gmail' ? 'Gmail' : 'SES'} settings first.`, 400);
    }

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = typeof providerConfig === 'string' ? JSON.parse(providerConfig) : providerConfig;
    } catch {
      throw new AppError(`Email provider "${provider}" configuration is invalid. Please reconfigure ${provider === 'gmail' ? 'Gmail' : 'SES'} settings.`, 400);
    }

    if (provider === 'gmail') {
      if (!parsedConfig.user || !parsedConfig.pass) {
        throw new AppError('Gmail configuration is incomplete: "user" and "pass" are required. Update Gmail settings first.', 400);
      }
    } else {
      if (!parsedConfig.region || !parsedConfig.accessKeyId || !parsedConfig.secretAccessKey) {
        throw new AppError('SES configuration is incomplete: "region", "accessKeyId", and "secretAccessKey" are required. Update SES settings first.', 400);
      }
      if (!parsedConfig.fromEmail) {
        throw new AppError('SES configuration is incomplete: "fromEmail" is required. Update SES settings first.', 400);
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

    const emailSubject = subject || 'Test Email from CadenceRelay';
    const emailHtml = html || '<h1>Test Email</h1><p>If you received this, your email provider is configured correctly.</p>';
    const emailText = html ? undefined : 'Test Email - If you received this, your email provider is configured correctly.';

    await emailProvider.send({
      to,
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
      replyTo,
    });

    res.json({ message: `Test email sent to ${to} via ${provider}` });
  } catch (err) {
    next(err);
  }
}
