import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import { API_ENV } from '../../config/config.module.js';

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class EmailChannel {
  private readonly transport: Transporter;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    });
  }

  async send(message: OutgoingMessage): Promise<void> {
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...message });
  }
}

/** Posts organizer alerts to a Discord webhook when one is configured (otherwise skipped). */
@Injectable()
export class DiscordChannel {
  private readonly logger = new Logger(DiscordChannel.name);

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get enabled(): boolean {
    return !!this.env.DISCORD_WEBHOOK_URL;
  }

  async send(content: string): Promise<void> {
    if (!this.env.DISCORD_WEBHOOK_URL) return;
    const res = await fetch(this.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
    if (!res.ok) {
      this.logger.warn(`Discord webhook responded ${res.status}`);
      throw new Error(`Discord webhook failed with ${res.status}`);
    }
  }
}
