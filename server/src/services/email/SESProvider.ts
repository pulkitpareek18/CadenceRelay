import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';
import {
  EmailProvider, EmailOptions, SendResult,
  PermanentBounceError, RateLimitError, AuthenticationError,
  TemporaryBounceError,
} from './EmailProvider';
import { logger } from '../../utils/logger';

interface SESConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromEmail: string;
  fromName?: string;
}

export class SESProvider implements EmailProvider {
  private client: SESClient;
  private fromEmail: string;
  private fromAddress: string;
  private transporter: nodemailer.Transporter;

  constructor(config: SESConfig) {
    this.fromEmail = config.fromEmail;
    // Build "Display Name <email>" format if fromName is provided
    this.fromAddress = config.fromName
      ? `"${config.fromName}" <${config.fromEmail}>`
      : config.fromEmail;
    this.client = new SESClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    // Use Nodemailer to build raw MIME messages (handles attachments, encoding, etc.)
    this.transporter = nodemailer.createTransport({ streamTransport: true });
  }

  async send(options: EmailOptions): Promise<SendResult> {
    try {
      // Build the raw MIME email using Nodemailer (supports attachments, HTML, text, headers)
      const mailOptions: nodemailer.SendMailOptions = {
        from: options.from || this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo,
        headers: options.headers || {},
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      };

      // Generate raw MIME message
      const info = await this.transporter.sendMail(mailOptions);
      const rawMessage = await streamToBuffer(info.message);

      // Send via SES SendRawEmailCommand
      const command = new SendRawEmailCommand({
        RawMessage: {
          Data: rawMessage,
        },
        Source: options.from || this.fromAddress,
        Destinations: [options.to],
      });

      const response = await this.client.send(command);
      const messageId = response.MessageId || '';

      logger.debug('SES: Email sent (raw)', { messageId, to: options.to, hasAttachments: !!(options.attachments?.length) });

      return {
        messageId,
        provider: 'ses',
      };
    } catch (error: unknown) {
      const err = error as { name?: string; message: string; $metadata?: { httpStatusCode?: number } };
      const statusCode = err.$metadata?.httpStatusCode;

      if (err.name === 'MessageRejected') {
        if (err.message?.includes('Email address is not verified') ||
            err.message?.includes('not authorized')) {
          throw new AuthenticationError(`SES: ${err.message}`);
        }
        throw new PermanentBounceError(`SES rejected: ${err.message}`, 'MessageRejected', options.to);
      }

      if (err.name === 'Throttling' || statusCode === 429) {
        throw new RateLimitError(`SES rate limit: ${err.message}`);
      }

      if (err.name === 'AccountSendingPausedException') {
        throw new AuthenticationError(`SES account suspended: ${err.message}`);
      }

      if (err.name === 'InvalidParameterValue') {
        throw new PermanentBounceError(`SES invalid param: ${err.message}`, 'InvalidParam', options.to);
      }

      if (statusCode && statusCode >= 500) {
        throw new TemporaryBounceError(`SES service error: ${err.message}`, String(statusCode), options.to);
      }

      logger.error('SES: Unclassified send error', { error: err.message, name: err.name, statusCode });
      throw error;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const { ListIdentitiesCommand } = await import('@aws-sdk/client-ses');
      await this.client.send(new ListIdentitiesCommand({ MaxItems: 1 }));
      logger.info('SES: Connection verified');
      return true;
    } catch (error) {
      logger.error('SES: Connection failed', { error: (error as Error).message });
      return false;
    }
  }
}

// Helper to convert Nodemailer stream to Buffer
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
