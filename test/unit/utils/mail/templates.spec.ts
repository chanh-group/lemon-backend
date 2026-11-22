import { describe, expect, it } from "vitest";
import { renderOtpEmail } from "../../../../src/utils/mail/templates.js";

describe("Mail Templates - renderOtpEmail", () => {
  it("renders signup OTP email in Vietnamese", () => {
    const { subject, text, html } = renderOtpEmail("123456", "signup", "vi");

    expect(subject).toContain("[LemonChat]");
    expect(subject).toContain("Xác thực đăng ký tài khoản");
    expect(subject).toContain("123456");

    expect(text).toContain("123456");
    expect(text).toContain("Xác thực đăng ký tài khoản");
    expect(text).toContain("2 phút");

    expect(html).toContain("123456");
    expect(html).toContain("LemonChat");
    expect(html).toContain("2 phút");
    expect(html).toContain('<html lang="vi">');
  });

  it("renders reset password OTP email in Vietnamese", () => {
    const { subject, text, html } = renderOtpEmail("654321", "reset", "vi");

    expect(subject).toContain("[LemonChat]");
    expect(subject).toContain("Đặt lại mật khẩu");
    expect(subject).toContain("654321");

    expect(text).toContain("654321");
    expect(text).toContain("Đặt lại mật khẩu");

    expect(html).toContain("654321");
  });

  it("renders English copy when lang is en", () => {
    const { subject, text, html } = renderOtpEmail("123456", "signup", "en");

    expect(subject).toContain("OTP code");
    expect(subject).toContain("Verify your sign-up");
    expect(text).toContain("Your OTP verification code is: 123456");
    expect(text).not.toContain("Mã xác thực");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("This code expires in");
  });

  it("uses the lime brand palette instead of the old yellow theme", () => {
    const { html } = renderOtpEmail("123456", "signup", "vi");

    expect(html).toContain("#00e676");
    expect(html).not.toContain("#eab308");
    expect(html).not.toContain("#fef08a");
  });
});
