import nodemailer from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from '../config.js';

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export function createSmtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.isProduction && config.smtp.port !== 465,
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: config.smtp.from, ...message });
    },
  };
}

/** Captures messages in memory; used by tests. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
  to(address: string): EmailMessage[] {
    return this.sent.filter((m) => m.to === address);
  }
  last(address: string): EmailMessage | undefined {
    return this.to(address).at(-1);
  }
}

/**
 * Sends without awaiting so response timing does not reveal whether an email
 * was sent (account enumeration). Failures are logged, never thrown.
 */
export function sendInBackground(mailer: Mailer, logger: Logger, message: EmailMessage): void {
  mailer.send(message).catch((err: unknown) => {
    logger.error({ err, subject: message.subject }, 'failed to send email');
  });
}
