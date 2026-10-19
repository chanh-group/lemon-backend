import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  changePasswordSchema,
  forgotPasswordOtpSchema,
  forgotPasswordResetSchema,
  loginSchema,
  requestOtpSchema,
  signupSchema,
  verifyOtpSchema,
} from "../../../../src/domain/auth/dto/request.js";

function messagesFor(schema: z.ZodType, input: unknown, path?: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => (path === undefined ? true : issue.path.join(".") === path))
    .map((issue) => issue.message);
}

describe("Auth DTO Validation Schemas", () => {
  describe("requestOtpSchema", () => {
    it("lowercases and trims valid email", () => {
      const parsed = requestOtpSchema.parse({ email: " LEMON@GMAIL.COM " });
      expect(parsed.email).toBe("lemon@gmail.com");
    });

    it("rejects invalid email with the VALIDATION_EMAIL key", () => {
      expect(messagesFor(requestOtpSchema, { email: "invalid-email" }, "email")).toEqual([
        "VALIDATION_EMAIL",
      ]);
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

    it("rejects non-digit OTP or OTP with incorrect length with VALIDATION_OTP_FORMAT", () => {
      const base = { email: "lemon@gmail.com" };
      expect(messagesFor(verifyOtpSchema, { ...base, otp: "12345" }, "otp")).toEqual([
        "VALIDATION_OTP_FORMAT",
      ]);
      expect(messagesFor(verifyOtpSchema, { ...base, otp: "1234567" }, "otp")).toEqual([
        "VALIDATION_OTP_FORMAT",
      ]);
      expect(messagesFor(verifyOtpSchema, { ...base, otp: "abcdef" }, "otp")).toEqual([
        "VALIDATION_OTP_FORMAT",
      ]);
    });
  });

  describe("signupSchema", () => {
    const validPayload = {
      email: "lemon@gmail.com",
      fullName: "Nguyen Van Lemon",
      username: "lemon_van",
      password: "MatKhau#123",
      otp: "123456",
    };

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

    it("rejects passwords shorter than 6 characters with VALIDATION_PASSWORD_MIN", () => {
      expect(messagesFor(signupSchema, { ...validPayload, password: "12345" }, "password")).toEqual(
        ["VALIDATION_PASSWORD_MIN|min=6"],
      );
    });

    it("rejects invalid username characters with VALIDATION_USERNAME_FORMAT", () => {
      expect(
        messagesFor(signupSchema, { ...validPayload, username: "lemon.van" }, "username"),
      ).toEqual(["VALIDATION_USERNAME_FORMAT"]);
    });

    it("rejects full names outside the 2-100 character range", () => {
      expect(messagesFor(signupSchema, { ...validPayload, fullName: "L" }, "fullName")).toEqual([
        "VALIDATION_FULL_NAME_MIN|min=2",
      ]);
      expect(
        messagesFor(signupSchema, { ...validPayload, fullName: "L".repeat(101) }, "fullName"),
      ).toEqual(["VALIDATION_FULL_NAME_MAX|max=100"]);
    });

    it("rejects usernames outside the 3-30 character range", () => {
      expect(messagesFor(signupSchema, { ...validPayload, username: "ab" }, "username")).toEqual([
        "VALIDATION_USERNAME_MIN|min=3",
        "VALIDATION_USERNAME_FORMAT",
      ]);
      expect(
        messagesFor(signupSchema, { ...validPayload, username: "a".repeat(31) }, "username"),
      ).toEqual(["VALIDATION_USERNAME_MAX|max=30", "VALIDATION_USERNAME_FORMAT"]);
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

    it("rejects empty identifier or password with the required keys", () => {
      expect(messagesFor(loginSchema, { identifier: "", password: "123" }, "identifier")).toEqual([
        "VALIDATION_IDENTIFIER_REQUIRED",
      ]);
      expect(messagesFor(loginSchema, { identifier: "lemon", password: "" }, "password")).toEqual([
        "VALIDATION_PASSWORD_REQUIRED",
      ]);
    });
  });

  describe("forgotPasswordOtpSchema", () => {
    it("lowercases and trims valid email", () => {
      const parsed = forgotPasswordOtpSchema.parse({ email: " RESET@GMAIL.COM " });
      expect(parsed.email).toBe("reset@gmail.com");
    });

    it("rejects invalid email with the VALIDATION_EMAIL key", () => {
      expect(messagesFor(forgotPasswordOtpSchema, { email: "invalid" }, "email")).toEqual([
        "VALIDATION_EMAIL",
      ]);
    });
  });

  describe("forgotPasswordResetSchema", () => {
    const validReset = {
      email: "lemon@gmail.com",
      otp: "654321",
      newPassword: "NewMatKhau#123",
    };

    it("validates reset payload", () => {
      const parsed = forgotPasswordResetSchema.parse(validReset);
      expect(parsed.newPassword).toBe("NewMatKhau#123");
      expect(parsed.otp).toBe("654321");
    });

    it("rejects short new password with VALIDATION_NEW_PASSWORD_MIN", () => {
      expect(
        messagesFor(
          forgotPasswordResetSchema,
          { ...validReset, newPassword: "123" },
          "newPassword",
        ),
      ).toEqual(["VALIDATION_NEW_PASSWORD_MIN|min=6"]);
    });

    it("rejects malformed OTP with VALIDATION_OTP_FORMAT", () => {
      expect(messagesFor(forgotPasswordResetSchema, { ...validReset, otp: "12ab" }, "otp")).toEqual(
        ["VALIDATION_OTP_FORMAT"],
      );
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

    it("rejects empty old password or short new password with the required keys", () => {
      expect(
        messagesFor(
          changePasswordSchema,
          { oldPassword: "", newPassword: "NewPassword#123" },
          "oldPassword",
        ),
      ).toEqual(["VALIDATION_OLD_PASSWORD_REQUIRED"]);
      expect(
        messagesFor(
          changePasswordSchema,
          { oldPassword: "OldPassword", newPassword: "12345" },
          "newPassword",
        ),
      ).toEqual(["VALIDATION_NEW_PASSWORD_MIN|min=6"]);
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
