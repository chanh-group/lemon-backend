import { describe, expect, it } from "vitest";
import { renderOtpEmail } from "../../../../src/utils/mail/templates.js";

describe("Mail Templates - renderOtpEmail", () => {
  it("renders signup OTP email correctly", () => {
    const { subject, text, html } = renderOtpEmail("123456", "signup");

    expect(subject).toContain("[LemonChat]");
    expect(subject).toContain("Xác thực đăng ký tài khoản");
    expect(subject).toContain("123456");

    expect(text).toContain("123456");
    expect(text).toContain("Xác thực đăng ký tài khoản");
    expect(text).toContain("2 phút");

    expect(html).toContain("123456");
    expect(html).toContain("LemonChat");
    expect(html).toContain("2 phút");
  });

  it("renders reset password OTP email correctly", () => {
    const { subject, text, html } = renderOtpEmail("654321", "reset");

    expect(subject).toContain("[LemonChat]");
    expect(subject).toContain("Đặt lại mật khẩu");
    expect(subject).toContain("654321");

    expect(text).toContain("654321");
    expect(text).toContain("Đặt lại mật khẩu");

    expect(html).toContain("654321");
  });
});
