import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  forgotPasswordOtpSchema,
  forgotPasswordResetSchema,
  loginSchema,
  requestOtpSchema,
  signupSchema,
  verifyOtpSchema,
} from "../../../../src/domain/auth/dto/request.js";

describe("Auth DTO Validation Schemas", () => {
  describe("requestOtpSchema", () => {
    it("lowercases and trims valid email", () => {
      const parsed = requestOtpSchema.parse({ email: " LEMON@GMAIL.COM " });
      expect(parsed.email).toBe("lemon@gmail.com");
    });

    it("rejects invalid email", () => {
      expect(() => requestOtpSchema.parse({ email: "invalid-email" })).toThrow();
    });
  });

  describe("verifyOtpSchema", () => {
    it("accepts valid 6-digit OTP", () => {
      const parsed = verifyOtpSchema.parse({
        email: "lemon@gmail.com",
        otp: "123456",
        purpose: "signup",
      });
      expect(parsed.otp).toBe("123456");
      expect(parsed.purpose).toBe("signup");
    });

    it("rejects non-digit OTP or OTP with incorrect length", () => {
      expect(() => verifyOtpSchema.parse({ email: "lemon@gmail.com", otp: "12345" })).toThrow();
      expect(() => verifyOtpSchema.parse({ email: "lemon@gmail.com", otp: "1234567" })).toThrow();
      expect(() => verifyOtpSchema.parse({ email: "lemon@gmail.com", otp: "abcdef" })).toThrow();
    });
  });

  describe("signupSchema", () => {
    it("validates full signup payload", () => {
      const parsed = signupSchema.parse({
        email: " LEMON@GMAIL.COM ",
        fullName: "  Nguyen Van Lemon  ",
        username: " LEMON_VAN ",
        password: "MatKhau#123",
        otp: "123456",
      });

      expect(parsed.email).toBe("lemon@gmail.com");
      expect(parsed.fullName).toBe("Nguyen Van Lemon");
      expect(parsed.username).toBe("lemon_van");
      expect(parsed.password).toBe("MatKhau#123");
      expect(parsed.otp).toBe("123456");
    });

    it("rejects passwords shorter than 6 characters", () => {
      expect(() =>
        signupSchema.parse({
          email: "lemon@gmail.com",
          fullName: "Nguyen Van Lemon",
          username: "lemon_van",
          password: "12345",
          otp: "123456",
        }),
      ).toThrow();
    });

    it("rejects invalid username characters", () => {
      expect(() =>
        signupSchema.parse({
          email: "lemon@gmail.com",
          fullName: "Nguyen Van Lemon",
          username: "lemon.van",
          password: "MatKhau#123",
          otp: "123456",
        }),
      ).toThrow();
    });
  });

  describe("loginSchema", () => {
    it("accepts valid identifier and password", () => {
      const parsed = loginSchema.parse({
        identifier: "lemon_van",
        password: "MatKhau#123",
      });
      expect(parsed.identifier).toBe("lemon_van");
      expect(parsed.password).toBe("MatKhau#123");
    });

    it("rejects empty identifier or password", () => {
      expect(() => loginSchema.parse({ identifier: "", password: "123" })).toThrow();
      expect(() => loginSchema.parse({ identifier: "lemon", password: "" })).toThrow();
    });
  });

  describe("forgotPasswordOtpSchema", () => {
    it("lowercases and trims valid email", () => {
      const parsed = forgotPasswordOtpSchema.parse({ email: " RESET@GMAIL.COM " });
      expect(parsed.email).toBe("reset@gmail.com");
    });

    it("rejects invalid email", () => {
      expect(() => forgotPasswordOtpSchema.parse({ email: "invalid" })).toThrow();
    });
  });

  describe("forgotPasswordResetSchema", () => {
    it("validates reset payload", () => {
      const parsed = forgotPasswordResetSchema.parse({
        email: "lemon@gmail.com",
        otp: "654321",
        newPassword: "NewMatKhau#123",
      });
      expect(parsed.newPassword).toBe("NewMatKhau#123");
      expect(parsed.otp).toBe("654321");
    });

    it("rejects short new password", () => {
      expect(() =>
        forgotPasswordResetSchema.parse({
          email: "lemon@gmail.com",
          otp: "654321",
          newPassword: "123",
        }),
      ).toThrow();
    });
  });

  describe("changePasswordSchema", () => {
    it("validates change password payload", () => {
      const parsed = changePasswordSchema.parse({
        oldPassword: "OldPassword#123",
        newPassword: "NewPassword#123",
      });
      expect(parsed.oldPassword).toBe("OldPassword#123");
      expect(parsed.newPassword).toBe("NewPassword#123");
    });

    it("rejects empty old password or short new password", () => {
      expect(() =>
        changePasswordSchema.parse({ oldPassword: "", newPassword: "NewPassword#123" }),
      ).toThrow();
      expect(() =>
        changePasswordSchema.parse({ oldPassword: "OldPassword", newPassword: "12345" }),
      ).toThrow();
    });
  });

  describe("Auth Mappers", () => {
    it("maps toAuthTokenResponse correctly", async () => {
      const { toAuthTokenResponse } = await import("../../../../src/domain/auth/dto/mapper.js");
      expect(toAuthTokenResponse("access_123")).toEqual({
        accessToken: "access_123",
      });
    });

    it("maps toLoginResponse correctly", async () => {
      const { toLoginResponse } = await import("../../../../src/domain/auth/dto/mapper.js");
      const user = {
        id: "usr-1",
        email: "a@b.com",
        username: "user1",
        fullName: "User One",
        avatarUrl: null,
        bio: null,
        phone: null,
        emailVerifiedAt: new Date(),
        lastSeenAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(toLoginResponse("access_123", user)).toEqual({
        accessToken: "access_123",
        user,
      });
    });

  });
});
