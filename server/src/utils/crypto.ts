import crypto from 'crypto';

export function generateTrackingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}
