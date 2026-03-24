import crypto from 'crypto';

export function generateTrackingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ── Credential encryption at rest ──
// Uses AES-256-GCM with a key derived from JWT_SECRET
// This ensures email provider credentials (Gmail password, SES keys) are never stored in plaintext

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET || 'default-dev-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a string. Returns base64 encoded: iv:ciphertext:authTag
 */
export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted}:${tag.toString('base64')}`;
}

/**
 * Decrypt a string. Expects base64 encoded: iv:ciphertext:authTag
 * Returns null if decryption fails (wrong key, tampered data)
 */
export function decryptCredential(encrypted: string): string | null {
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) return null;
    const [ivB64, ciphertextB64, tagB64] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertextB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Check if a value looks like it's already encrypted (base64:base64:base64 format)
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  try {
    for (const part of parts) {
      Buffer.from(part, 'base64');
    }
    return true;
  } catch {
    return false;
  }
}
