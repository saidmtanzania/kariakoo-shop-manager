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
 * Delivers transactional email over SMTP (any provider; Mailpit locally;
 * decision A-014). Application code never calls this directly: it queues
 * mail through OutboxService in the same transaction as the change, and the
 * outbox worker calls deliver() with retries (decision A-007).
 *
 * With MAIL_TRANSPORT=memory, delivered messages are kept in `sent` for tests.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  readonly sent: MailMessage[] = [];

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

  /** Sends one message; throws when the transport fails so the worker retries. */
  async deliver(message: MailMessage): Promise<void> {
    if (this.config.MAIL_TRANSPORT === 'memory') {
      this.sent.push(message);
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
    await this.transporter!.sendMail({
      from: this.config.MAIL_FROM,
      ...message,
    });
  }

  /** Builds an absolute link to a web page; the token goes in the fragment so it never reaches server logs. */
  link(path: string, token?: string): string {
    const url = `${this.config.APP_URL}${path}`;
    return token ? `${url}#token=${encodeURIComponent(token)}` : url;
  }
}
