import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { MailService } from "../../../../src/utils/mail/service.js";
import {
  MAIL_QUEUE_CONCURRENCY,
  MAIL_QUEUE_MAX_SIZE,
  MAIL_RETRY_BACKOFFS_MS,
  MAIL_RETRY_COUNT,
} from "../../../../src/utils/mail/constants.js";
import { Logger } from "@nestjs/common";

function enableSmtp(): void {
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USERNAME = "lemon@gmail.com";
  process.env.SMTP_PASSWORD = "secretpassword";
  process.env.SMTP_FROM = "LemonChat <lemon@gmail.com>";
}

function stubTransport(sendMail: unknown): void {
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({
    sendMail,
    close: vi.fn(),
  } as unknown as ReturnType<typeof nodemailer.createTransport>);
}

describe("MailService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("boots in log-only mode when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;

    const log = vi.spyOn(Logger.prototype, "log");
    const service = new MailService();
    expect(service.getQueueSize()).toBe(0);

    await service.sendOtp({
      to: "test@example.com",
      code: "123456",
      purpose: "signup",
    });

    await service.onModuleDestroy();

    expect(JSON.stringify(log.mock.calls)).not.toContain("123456");
    expect(JSON.stringify(log.mock.calls)).not.toContain("test@example.com");
  });

  it("initializes nodemailer transporter when SMTP credentials exist", async () => {
    enableSmtp();

    const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
    const mockClose = vi.fn();
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: mockSendMail,
      close: mockClose,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);

    const service = new MailService();

    await service.sendOtp({
      to: "recipient@example.com",
      code: "999888",
      purpose: "signup",
    });

    await service.onModuleDestroy();

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "LemonChat <lemon@gmail.com>",
        to: "recipient@example.com",
        subject: expect.stringContaining("999888"),
      }),
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it("retries a failed delivery only after the backoff delay", async () => {
    enableSmtp();
    vi.useFakeTimers();
    const callTimes: number[] = [];
    const mockSendMail = vi.fn(() => {
      callTimes.push(Date.now());
      return callTimes.length === 1
        ? Promise.reject(new Error("Delivery failed for retry@example.com"))
        : Promise.resolve({ messageId: "456" });
    });
    stubTransport(mockSendMail);
    const log = vi.spyOn(Logger.prototype, "log");
    const warn = vi.spyOn(Logger.prototype, "warn");

    const service = new MailService();
    await service.sendOtp({ to: "retry@example.com", code: "112233", purpose: "reset" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Mail delivery failed", {
      action: "mail.delivery_failed",
      attempt: 1,
    });

    // The retry is scheduled with the first backoff — nothing runs before it.
    await vi.advanceTimersByTimeAsync(MAIL_RETRY_BACKOFFS_MS[0] - 1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect((callTimes[1] ?? 0) - (callTimes[0] ?? 0)).toBeGreaterThanOrEqual(
      MAIL_RETRY_BACKOFFS_MS[0],
    );
    expect(log).toHaveBeenCalledWith("Mail sent successfully", {
      action: "mail.sent",
      attempt: 2,
    });
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain(
      "retry@example.com",
    );
    await service.onModuleDestroy();
  });

  it("keeps the worker slot free while a failed delivery waits to retry", async () => {
    enableSmtp();
    vi.useFakeTimers();
    const mockSendMail = vi
      .fn()
      .mockRejectedValueOnce(new Error("flaky SMTP"))
      .mockResolvedValue({ messageId: "ok" });
    stubTransport(mockSendMail);

    const service = new MailService();
    const flaky = { to: "flaky@example.com", subject: "s", text: "t", html: "h" };
    const next = { to: "next@example.com", subject: "s", text: "t", html: "h" };
    await service.sendRaw(flaky);
    await vi.advanceTimersByTimeAsync(0); // first attempt failed; retry scheduled
    await service.sendRaw(next);
    await vi.advanceTimersByTimeAsync(0); // second mail delivered while the first backs off

    expect(mockSendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: "flaky@example.com" }),
    );
    expect(mockSendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: "next@example.com" }),
    );

    await vi.advanceTimersByTimeAsync(MAIL_RETRY_BACKOFFS_MS[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSendMail).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ to: "flaky@example.com" }),
    );
  });

  it("gives up after the retry budget and logs the permanent failure", async () => {
    enableSmtp();
    vi.useFakeTimers();
    const mockSendMail = vi
      .fn()
      .mockRejectedValue(new Error("Delivery failed for retry@example.com"));
    stubTransport(mockSendMail);
    const warn = vi.spyOn(Logger.prototype, "warn");

    const service = new MailService();
    await service.sendOtp({ to: "retry@example.com", code: "112233", purpose: "reset" });

    for (const backoff of MAIL_RETRY_BACKOFFS_MS) {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(backoff);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSendMail).toHaveBeenCalledTimes(MAIL_RETRY_COUNT + 1);
    expect(warn).toHaveBeenCalledWith("Mail delivery failed", {
      action: "mail.delivery_failed",
      attempt: MAIL_RETRY_COUNT + 1,
    });
    expect(warn).toHaveBeenCalledWith("Mail permanently failed after all retries", {
      action: "mail.send_failed",
    });

    await vi.advanceTimersByTimeAsync(MAIL_RETRY_BACKOFFS_MS.at(-1)! * 10);
    expect(mockSendMail).toHaveBeenCalledTimes(MAIL_RETRY_COUNT + 1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("retry@example.com");
    await service.onModuleDestroy();
  });

  it("drops new sends when the mail queue is full", async () => {
    enableSmtp();
    // Hold every worker slot so the queue can actually fill up; later
    // deliveries resolve instantly.
    let calls = 0;
    const releases: Array<(value: { messageId: string }) => void> = [];
    const mockSendMail = vi.fn(() => {
      calls++;
      if (calls <= MAIL_QUEUE_CONCURRENCY) {
        return new Promise<{ messageId: string }>((resolve) => {
          releases.push(resolve);
        });
      }
      return Promise.resolve({ messageId: "ok" });
    });
    stubTransport(mockSendMail);
    const warn = vi.spyOn(Logger.prototype, "warn");

    const service = new MailService();
    for (let i = 0; i < MAIL_QUEUE_CONCURRENCY; i++) {
      await service.sendOtp({ to: "first@example.com", code: "111111", purpose: "signup" });
    }
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(MAIL_QUEUE_CONCURRENCY));

    for (let i = 0; i < MAIL_QUEUE_MAX_SIZE; i++) {
      await service.sendOtp({ to: "queued@example.com", code: "222222", purpose: "signup" });
    }
    expect(service.getQueueSize()).toBe(MAIL_QUEUE_MAX_SIZE);

    await service.sendOtp({ to: "dropped@example.com", code: "333333", purpose: "signup" });
    await service.sendRaw({ to: "dropped@example.com", subject: "raw", text: "raw", html: "raw" });
    expect(warn).toHaveBeenCalledWith("Mail queue is full, dropping email", {
      action: "mail.queue_full",
    });
    expect(warn).toHaveBeenCalledWith("Mail queue is full, dropping raw email", {
      action: "mail.queue_full",
    });

    for (const release of releases) release({ messageId: "first" });
    await service.onModuleDestroy();
    expect(mockSendMail).toHaveBeenCalledTimes(MAIL_QUEUE_MAX_SIZE + MAIL_QUEUE_CONCURRENCY);
  });
});
