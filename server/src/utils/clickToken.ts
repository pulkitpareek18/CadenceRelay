import crypto from 'crypto';

// Stateless click-tracking token for sends that don't have a campaign_recipients
// row to look up link_urls in (e.g. the /settings/test-email path used for
// template QA). Format: "t_<base64url(url)>.<hmacB64Url>" — the `t_` prefix
// distinguishes from campaign tracking_token (32 hex) and from contact unsub
// tokens (`c_...`).
//
// Same HMAC scheme as unsubscribeToken: SHA256 keyed by UNSUBSCRIBE_HMAC_SECRET
// (falls back to JWT_SECRET), truncated to 16 bytes. We sign the payload so a
// recipient can't tamper the redirect target into an open redirect.

const TOKEN_PREFIX = 't_';
const HMAC_BYTES = 16;

function getHmacSecret(): string {
  return process.env.UNSUBSCRIBE_HMAC_SECRET || process.env.JWT_SECRET || 'default-dev-secret';
}

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', getHmacSecret())
    .update(payload)
    .digest()
    .subarray(0, HMAC_BYTES)
    .toString('base64url');
}

export function generateClickToken(url: string): string {
  const payload = `${TOKEN_PREFIX}${Buffer.from(url, 'utf8').toString('base64url')}`;
  return `${payload}.${hmac(payload)}`;
}

export function parseClickToken(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const dotAt = token.indexOf('.');
  if (dotAt < 0) return null;
  const payload = token.slice(0, dotAt);
  const sig = token.slice(dotAt + 1);
  const expected = hmac(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return Buffer.from(payload.slice(TOKEN_PREFIX.length), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
