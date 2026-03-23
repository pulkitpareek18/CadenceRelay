export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export interface EmailProvider {
  send(options: EmailOptions): Promise<SendResult>;
  verifyConnection(): Promise<boolean>;
}

// Custom error classes for SMTP error classification
export class PermanentBounceError extends Error {
  public code: string;
  public recipient: string;

  constructor(message: string, code: string, recipient: string) {
    super(message);
    this.name = 'PermanentBounceError';
    this.code = code;
    this.recipient = recipient;
  }
}

export class TemporaryBounceError extends Error {
  public code: string;
  public recipient: string;

  constructor(message: string, code: string, recipient: string) {
    super(message);
    this.name = 'TemporaryBounceError';
    this.code = code;
    this.recipient = recipient;
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// Classify SMTP response codes
export function classifySmtpError(responseCode: number | string, message: string, recipient: string): Error {
  const code = typeof responseCode === 'string' ? parseInt(responseCode) : responseCode;

  // 5xx = permanent failure
  if (code >= 550 && code <= 559) {
    // 550 = mailbox not found, 551 = user not local, 552 = exceeded storage,
    // 553 = mailbox name not allowed, 554 = transaction failed
    return new PermanentBounceError(message, String(code), recipient);
  }

  // 4xx = temporary failure
  if (code >= 400 && code < 500) {
    // 421 = service not available, 450 = mailbox unavailable, 451 = local error, 452 = insufficient storage
    return new TemporaryBounceError(message, String(code), recipient);
  }

  // Auth failures
  if (code === 535 || code === 530) {
    return new AuthenticationError(message);
  }

  // Rate limits (Gmail-specific patterns)
  if (message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('too many') || code === 429) {
    return new RateLimitError(message);
  }

  // Default: treat as temporary so it gets retried
  return new TemporaryBounceError(message, String(code || 'unknown'), recipient);
}
