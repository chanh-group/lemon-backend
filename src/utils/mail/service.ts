import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import PQueue from "p-queue";
import {
  MAIL_QUEUE_CONCURRENCY,
  MAIL_QUEUE_MAX_SIZE,
  MAIL_RETRY_BACKOFFS_MS,
  MAIL_RETRY_COUNT,
} from "./constants.js";
import {
  buildTransportOptions,
  from_env,
  isEnabled,
  validate,
  type MailConfig,
} from "./config.js";
import { renderOtpEmail } from "./templates.js";
import type { MailJob, SendOtpMailOptions } from "./types.js";

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly queue: PQueue;
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;

  constructor(config: MailConfig = from_env()) {
    this.queue = new PQueue({ concurrency: MAIL_QUEUE_CONCURRENCY });

    validate(config);
    this.fromAddress = config.from;

    if (!isEnabled(config)) {
      this.transporter = null;
      this.logger.warn(
        "SMTP not configured. Emails will be logged to console (log-only mode)",
        {
          action: "mail.log_only_mode",
        },
      );
      return;
    }

    const options = buildTransportOptions(config);
    if (options.plaintextRelay) {
      this.logger.warn(
        `Non-standard SMTP port ${config.port}; using plaintext (dev relay only)`,
        { action: "mail.plaintext_relay", host: config.host, port: config.port },
      );
    }
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: options.requireTLS,
      auth: options.auth,
      connectionTimeout: options.connectionTimeout,
    });
    this.logger.log("SMTP transporter initialized", {
      action: "mail.init",
      host: options.host,
      port: options.port,
    });
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
      this.logger.log("Email delivered (log-only mode)", {
        action: "mail.send_dev",
        to: job.to,
        subject: job.subject.replace(/:\s*\d{6}\s*$/, ""),
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
