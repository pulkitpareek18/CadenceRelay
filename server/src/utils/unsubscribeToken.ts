import crypto from 'crypto';

// Stateless unsubscribe token for sends that don't have a campaign_recipients
// row (automation drips, etc). Format: "c_<contactId>.<hmacB64Url>" — the `c_`
// prefix and `.` separator distinguish it from the campaign tracking_token
// (which is 32 hex chars with no punctuation).
//
// HMAC-SHA256 keyed by UNSUBSCRIBE_HMAC_SECRET (falls back to JWT_SECRET for
// single-deployment setups). Truncated to 16 bytes — collision resistance is
// not the concern here; forgery resistance is, and 128-bit truncated HMAC is
// the standard recommendation.

const TOKEN_PREFIX = 'c_';
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

export function generateContactUnsubToken(contactId: string): string {
  const payload = `${TOKEN_PREFIX}${contactId}`;
  return `${payload}.${hmac(payload)}`;
}

export function parseContactUnsubToken(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const dotAt = token.indexOf('.');
  if (dotAt < 0) return null;
  const payload = token.slice(0, dotAt);
  const sig = token.slice(dotAt + 1);
  const expected = hmac(payload);
  // Length check first — timingSafeEqual throws on unequal lengths.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return payload.slice(TOKEN_PREFIX.length);
}
