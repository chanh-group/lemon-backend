import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import PQueue from "p-queue";
import { get_env } from "../../helpers/index.js";
import {
  MAIL_QUEUE_CONCURRENCY,
  MAIL_QUEUE_MAX_SIZE,
  MAIL_RETRY_BACKOFFS_MS,
  MAIL_RETRY_COUNT,
} from "./constants.js";
import { renderOtpEmail } from "./templates.js";
import type { MailJob, SendOtpMailOptions } from "./types.js";

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly queue: PQueue;
  private readonly transporter: Transporter | null = null;
  private readonly fromAddress: string;

  constructor() {
    this.queue = new PQueue({ concurrency: MAIL_QUEUE_CONCURRENCY });

    const host = get_env("SMTP_HOST", "");
    const port = Number(get_env("SMTP_PORT", "465"));
    const user = get_env("SMTP_USERNAME", "");
    const pass = get_env("SMTP_PASSWORD", "");
    this.fromAddress = get_env("SMTP_FROM", "LemonChat <onboarding@resend.dev>");

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log("SMTP transporter initialized", { action: "mail.init", host, port });
    } else {
      this.logger.warn("SMTP not configured. Emails will be logged to console (log-only mode)", {
        action: "mail.log_only_mode",
      });
    }
  }

  async sendOtp(options: SendOtpMailOptions): Promise<void> {
    if (this.queue.size >= MAIL_QUEUE_MAX_SIZE) {
      this.logger.warn("Mail queue is full, dropping email", {
        action: "mail.queue_full",
        to: options.to,
        requestId: options.requestId,
      });
      return;
    }

    const { subject, text, html } = renderOtpEmail(options.code, options.purpose);

    const job: MailJob = {
      to: options.to,
      subject,
      text,
      html,
      requestId: options.requestId,
    };

    void this.queue.add(() => this.deliverWithRetry(job));
  }

  async sendRaw(job: MailJob): Promise<void> {
    if (this.queue.size >= MAIL_QUEUE_MAX_SIZE) {
      this.logger.warn("Mail queue is full, dropping raw email", {
        action: "mail.queue_full",
        to: job.to,
        requestId: job.requestId,
      });
      return;
    }

    void this.queue.add(() => this.deliverWithRetry(job));
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log("Draining mail queue on shutdown...", { action: "mail.drain" });
      await Promise.race([
        this.queue.onIdle(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (this.transporter) {
        this.transporter.close();
      }
    } catch (err: unknown) {
      this.logger.warn(`Error while draining mail queue: ${String(err)}`);
    }
  }

  private async deliverWithRetry(job: MailJob): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[OTP DEV] To: ${job.to} | Subject: ${job.subject}\n${job.text}`, {
        action: "mail.send_dev",
        to: job.to,
        requestId: job.requestId,
      });
      return;
    }

    let attempt = 0;
    while (attempt <= MAIL_RETRY_COUNT) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: job.to,
          subject: job.subject,
          text: job.text,
          html: job.html,
        });

        this.logger.log("Mail sent successfully", {
          action: "mail.sent",
          to: job.to,
          requestId: job.requestId,
          attempt: attempt + 1,
        });
        return;
      } catch (err: unknown) {
        attempt++;
        this.logger.warn("Mail delivery failed", {
          action: "mail.delivery_failed",
          to: job.to,
          attempt,
          err: String(err),
          requestId: job.requestId,
        });

        if (attempt <= MAIL_RETRY_COUNT) {
          const delay = MAIL_RETRY_BACKOFFS_MS[attempt - 1] ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.warn("Mail permanently failed after all retries", {
      action: "mail.send_failed",
      to: job.to,
      requestId: job.requestId,
    });
  }
}
