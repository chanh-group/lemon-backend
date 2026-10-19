import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { MailService } from "../../../../src/utils/mail/service.js";
import { Logger } from "@nestjs/common";

describe("MailService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
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

    expect(log.mock.calls.flat().join(" ")).not.toContain("123456");
  });

  it("initializes nodemailer transporter when SMTP credentials exist", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USERNAME = "lemon@gmail.com";
    process.env.SMTP_PASSWORD = "secretpassword";
    process.env.SMTP_FROM = "LemonChat <lemon@gmail.com>";

    const mockSendMail = vi.fn().mockResolvedValue({ messageId: "123" });
    const mockClose = vi.fn();
    const mockTransport = {
      sendMail: mockSendMail,
      close: mockClose,
    };

    vi.spyOn(nodemailer, "createTransport").mockReturnValue(
      mockTransport as unknown as ReturnType<typeof nodemailer.createTransport>,
    );

    const service = new MailService();

    await service.sendOtp({
      to: "recipient@example.com",
      code: "999888",
      purpose: "signup",
      requestId: "req-1",
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

  it("retries delivery when transporter fails on first attempt", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USERNAME = "lemon@gmail.com";
    process.env.SMTP_PASSWORD = "secretpassword";
    process.env.SMTP_FROM = "LemonChat <lemon@gmail.com>";

    const mockSendMail = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection reset"))
      .mockResolvedValueOnce({ messageId: "456" });

    const mockTransport = {
      sendMail: mockSendMail,
      close: vi.fn(),
    };

    vi.spyOn(nodemailer, "createTransport").mockReturnValue(
      mockTransport as unknown as ReturnType<typeof nodemailer.createTransport>,
    );

    const service = new MailService();

    await service.sendOtp({
      to: "retry@example.com",
      code: "112233",
      purpose: "reset",
    });

    await service.onModuleDestroy();

    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });
});
