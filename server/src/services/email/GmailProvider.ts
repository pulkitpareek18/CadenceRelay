import nodemailer from 'nodemailer';
import {
  EmailProvider, EmailOptions, SendResult,
  PermanentBounceError, TemporaryBounceError, RateLimitError, AuthenticationError,
  classifySmtpError,
} from './EmailProvider';
import { logger } from '../../utils/logger';

interface GmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export class GmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;

  constructor(config: GmailConfig) {
    this.fromEmail = config.user;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });
  }

  async send(options: EmailOptions): Promise<SendResult> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: options.from || this.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || this.fromEmail,
      headers: options.headers || {},
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.debug('Gmail: Email sent', { messageId: info.messageId, to: options.to });

      // Check for rejected recipients (SMTP accepted but flagged)
      if (info.rejected && info.rejected.length > 0) {
        throw new PermanentBounceError(
          `Recipient rejected by SMTP: ${info.rejected.join(', ')}`,
          '550',
          options.to
        );
      }

      return {
        messageId: info.messageId,
        provider: 'gmail',
      };
    } catch (error: unknown) {
      // If it's already one of our classified errors, re-throw
      if (
        error instanceof PermanentBounceError ||
        error instanceof TemporaryBounceError ||
        error instanceof RateLimitError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }

      const err = error as { responseCode?: number; code?: string; message: string };

      // Classify SMTP errors from Nodemailer
      if (err.responseCode) {
        throw classifySmtpError(err.responseCode, err.message, options.to);
      }

      // Connection errors (ECONNREFUSED, ETIMEDOUT, etc.)
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') {
        throw new TemporaryBounceError(
          `Gmail SMTP connection error: ${err.message}`,
          err.code,
          options.to
        );
      }

      // Auth errors
      if (err.code === 'EAUTH' || err.message?.includes('Invalid login')) {
        throw new AuthenticationError(`Gmail authentication failed: ${err.message}`);
      }

      // Gmail rate limit patterns
      if (err.message?.includes('Daily user sending limit exceeded') ||
          err.message?.includes('too many') ||
          err.message?.includes('rate limit')) {
        throw new RateLimitError(`Gmail rate limit: ${err.message}`);
      }

      // Unknown error - rethrow as-is
      logger.error('Gmail: Unclassified send error', { error: err.message, code: err.code, responseCode: err.responseCode });
      throw error;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('Gmail: SMTP connection verified');
      return true;
    } catch (error) {
      logger.error('Gmail: SMTP connection failed', { error: (error as Error).message });
      return false;
    }
  }
}
