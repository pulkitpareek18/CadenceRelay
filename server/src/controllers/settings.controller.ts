import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

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
    const result = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      // FIX: Mask sensitive fields before returning
      let value = row.value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === 'object' && parsed !== null) {
            value = JSON.stringify(maskSensitiveValues(parsed));
          }
        } catch {
          // not JSON, keep as-is
        }
      }
      settings[row.key] = value;
    }
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

    res.json({ message: 'Provider updated', provider });
  } catch (err) {
    next(err);
  }
}

export async function updateGmailConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { host, port, user, pass } = req.body;
    const config = { host: host || 'smtp.gmail.com', port: port || 587, user, pass };

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(config), 'gmail_config']
    );

    res.json({ message: 'Gmail config updated' });
  } catch (err) {
    next(err);
  }
}

export async function updateSesConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { region, accessKeyId, secretAccessKey, fromEmail } = req.body;
    const config = { region, accessKeyId, secretAccessKey, fromEmail };

    await pool.query(
      'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(config), 'ses_config']
    );

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

    res.json({ message: 'Throttle defaults updated' });
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
    });

    res.json({ message: `Test email sent to ${to} via ${provider}` });
  } catch (err) {
    next(err);
  }
}
