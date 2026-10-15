import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends transactional email over SMTP (any provider; Mailpit locally).
 * With MAIL_TRANSPORT=memory, messages are kept in `outbox` for tests.
 *
 * Sending happens after the database change commits and a failure is logged,
 * not surfaced, so responses never reveal whether an account exists. A
 * transactional outbox replaces this in Phase 03 (decision A-007).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  readonly outbox: MailMessage[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transporter =
      config.MAIL_TRANSPORT === 'smtp'
        ? nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: config.SMTP_SECURE,
            auth: config.SMTP_USER
              ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' }
              : undefined,
          })
        : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.config.MAIL_TRANSPORT === 'memory') {
      this.outbox.push(message);
      return;
    }
    if (this.config.MAIL_TRANSPORT === 'log') {
      // Never log the body: it carries single-use tokens.
      this.logger.log(
        { subject: message.subject },
        'Email not sent (MAIL_TRANSPORT=log)',
      );
      return;
    }
    try {
      await this.transporter!.sendMail({
        from: this.config.MAIL_FROM,
        ...message,
      });
    } catch (err) {
      this.logger.error(
        { err, subject: message.subject },
        'Failed to send email',
      );
    }
  }

  /** Builds an absolute link to a web page; the token goes in the fragment so it never reaches server logs. */
  link(path: string, token?: string): string {
    const url = `${this.config.APP_URL}${path}`;
    return token ? `${url}#token=${encodeURIComponent(token)}` : url;
  }
}
