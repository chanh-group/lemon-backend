import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import PQueue from "p-queue";
import {
  MAIL_QUEUE_CONCURRENCY,
  MAIL_QUEUE_MAX_SIZE,
  MAIL_QUEUE_DRAIN_TIMEOUT_MS,
  MAIL_RETRY_BACKOFFS_MS,
  MAIL_RETRY_COUNT,
} from "./constants.js";
import {
  buildTransportOptions,
  from_env,
  isEnabled,
  MAIL_CONFIG,
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

  constructor(@Inject(MAIL_CONFIG) config: MailConfig = from_env()) {
    this.queue = new PQueue({ concurrency: MAIL_QUEUE_CONCURRENCY });

    validate(config);
    this.fromAddress = config.from;

    if (!isEnabled(config)) {
      this.transporter = null;
      this.logger.warn("SMTP not configured. Emails will be logged to console (log-only mode)", {
        action: "mail.log_only_mode",
      });
      return;
    }

    const options = buildTransportOptions(config);
    if (options.plaintextRelay) {
      this.logger.warn(`Non-standard SMTP port ${config.port}; using plaintext (dev relay only)`, {
        action: "mail.plaintext_relay",
        host: config.host,
        port: config.port,
      });
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
      });
      return;
    }

    const { subject, text, html } = renderOtpEmail(options.code, options.purpose, options.lang);

    const job: MailJob = {
      to: options.to,
      subject,
      text,
      html,
    };

    void this.queue.add(() => this.deliverOnce(job, 0));
  }

  async sendRaw(job: MailJob): Promise<void> {
    if (this.queue.size >= MAIL_QUEUE_MAX_SIZE) {
      this.logger.warn("Mail queue is full, dropping raw email", {
        action: "mail.queue_full",
      });
      return;
    }

    void this.queue.add(() => this.deliverOnce(job, 0));
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log("Draining mail queue on shutdown...", { action: "mail.drain" });
      await Promise.race([
        this.queue.onIdle(),
        new Promise((resolve) => setTimeout(resolve, MAIL_QUEUE_DRAIN_TIMEOUT_MS)),
      ]);
      if (this.transporter) {
        this.transporter.close();
      }
    } catch (err: unknown) {
      this.logger.warn(`Error while draining mail queue: ${String(err)}`);
    }
  }

  /** One delivery attempt; retryable failures re-enqueue instead of sleeping here. */
  private async deliverOnce(job: MailJob, attempt: number): Promise<void> {
    if (!this.transporter) {
      this.logger.log("Email delivered (log-only mode)", {
        action: "mail.send_dev",
      });
      return;
    }

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
        attempt: attempt + 1,
      });
    } catch {
      this.retryOrFail(job, attempt);
    }
  }

  /**
   * Re-enqueue the send after its backoff delay (p-queue has no per-task
   * `delay`, so the wait happens outside the queue) — the worker slot stays
   * free for other mail while this one backs off. Exhausted retries are dropped.
   */
  private retryOrFail(job: MailJob, attempt: number): void {
    const attemptsMade = attempt + 1;
    this.logger.warn("Mail delivery failed", {
      action: "mail.delivery_failed",
      attempt: attemptsMade,
    });

    if (attemptsMade > MAIL_RETRY_COUNT) {
      this.logger.warn("Mail permanently failed after all retries", {
        action: "mail.send_failed",
      });
      return;
    }

    const delay = MAIL_RETRY_BACKOFFS_MS[attemptsMade - 1] ?? MAIL_RETRY_BACKOFFS_MS.at(-1)!;
    setTimeout(() => {
      void this.queue.add(() => this.deliverOnce(job, attemptsMade));
    }, delay);
  }
}
