import { pool } from '../config/database';
import { logger } from './logger';

const TRACKING_PATH_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Validate a tracking domain string. Returns the cleaned URL (no trailing slash)
 * or null if invalid.
 */
export function validateTrackingDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/^"|"$/g, '').trim();
  if (!stripped) return null;
  if (!TRACKING_PATH_RE.test(stripped)) return null;
  try {
    const u = new URL(stripped);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.hostname === 'localhost' || u.hostname.startsWith('127.')) {
      // Localhost is only valid in non-production; the caller decides.
      return `${u.protocol}//${u.host}`;
    }
    // Strip any path, query, hash — tracking domain is just origin.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the active tracking domain.
 *
 * Order of precedence (strict):
 *   1. process.env.TRACKING_DOMAIN — authoritative when set, regardless of DB.
 *   2. settings.tracking_domain row in DB — only consulted when env is unset.
 *
 * This matters because campaign tracking links are baked into emails at send
 * time. A wrong value silently breaks every open/click, so we never trust the
 * DB row over an explicit operator-set env in production.
 *
 * Returns the validated origin (e.g. "https://cadencerelay.example.com") or
 * throws if neither source provides a valid URL.
 */
export async function resolveTrackingDomain(): Promise<string> {
  const fromEnv = validateTrackingDomain(process.env.TRACKING_DOMAIN);
  if (fromEnv) {
    if (fromEnv.startsWith('http://') && process.env.NODE_ENV === 'production') {
      logger.warn('TRACKING_DOMAIN is using http:// in production; tracking links will not be secure', {
        trackingDomain: fromEnv,
      });
    }
    return fromEnv;
  }

  if (process.env.NODE_ENV === 'production') {
    // In production we refuse to silently fall back to whatever is in the DB —
    // an imported backup or stale row could ruin a campaign. Operator must set
    // TRACKING_DOMAIN explicitly.
    throw new Error(
      'TRACKING_DOMAIN env var is required in production. Refusing to read tracking_domain from DB to prevent campaigns from going out with the wrong tracking host.'
    );
  }

  const dbResult = await pool.query("SELECT value FROM settings WHERE key = 'tracking_domain'");
  const fromDb = validateTrackingDomain(dbResult.rows[0]?.value);
  if (fromDb) return fromDb;

  throw new Error('No valid tracking domain configured (env unset and DB value missing/invalid).');
}

/**
 * Validate that TRACKING_DOMAIN is set and well-formed. Call once at boot —
 * the server should refuse to start with a bad value rather than silently
 * mis-track campaigns.
 */
export function assertTrackingDomainAtBoot(): void {
  if (process.env.NODE_ENV === 'production') {
    const v = validateTrackingDomain(process.env.TRACKING_DOMAIN);
    if (!v) {
      throw new Error(
        `Refusing to start: TRACKING_DOMAIN env var must be a valid http(s) URL in production. Got: ${JSON.stringify(process.env.TRACKING_DOMAIN)}`
      );
    }
    if (v.startsWith('http://')) {
      throw new Error(
        `Refusing to start: TRACKING_DOMAIN must use https:// in production (got ${v}). Tracking pixels and click links would otherwise be sent over plaintext.`
      );
    }
    logger.info('Tracking domain validated at boot', { trackingDomain: v });
  }
}
