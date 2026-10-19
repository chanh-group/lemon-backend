import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  changePasswordSchema,
  createUserSchema,
  updatePasswordHashSchema,
  updateUserSchema,
} from "../../../../src/domain/user/dto/request.js";
import { toUserResponse } from "../../../../src/domain/user/dto/mapper.js";
import type { User } from "../../../../src/domain/user/schema.js";

function messagesFor(schema: z.ZodType, input: unknown, path?: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => (path === undefined ? true : issue.path.join(".") === path))
    .map((issue) => issue.message);
}

describe("User DTOs & Validation Schemas", () => {
  describe("createUserSchema", () => {
    it("lowercases email and username and trims full name", () => {
      const parsed = createUserSchema.parse({
        email: " LEMON@Example.COM ",
        username: "LEMON_user ",
        fullName: "  Nguyen Van Lemon  ",
        passwordHash: "argon2id$mockhash",
      });

      expect(parsed.email).toBe("lemon@example.com");
      expect(parsed.username).toBe("lemon_user");
      expect(parsed.fullName).toBe("Nguyen Van Lemon");
      expect(parsed.passwordHash).toBe("argon2id$mockhash");
    });

    it("rejects when neither passwordHash nor googleId is provided with VALIDATION_ACCOUNT_CREDENTIALS_REQUIRED", () => {
      expect(
        messagesFor(
          createUserSchema,
          {
            email: "lemon@example.com",
            username: "lemon_user",
            fullName: "Nguyen Van Lemon",
          },
          "passwordHash",
        ),
      ).toEqual(["VALIDATION_ACCOUNT_CREDENTIALS_REQUIRED"]);
    });

    it("accepts when googleId is provided without passwordHash (OAuth)", () => {
      const parsed = createUserSchema.parse({
        email: "lemon@example.com",
        username: "lemon_user",
        fullName: "Nguyen Van Lemon",
        googleId: "google-oauth-12345",
      });
      expect(parsed.googleId).toBe("google-oauth-12345");
      expect(parsed.passwordHash).toBeUndefined();
    });

    it("rejects invalid email formats with VALIDATION_EMAIL", () => {
      expect(
        messagesFor(
          createUserSchema,
          {
            email: "not-an-email",
            username: "lemon_user",
            fullName: "Nguyen Van Lemon",
          },
          "email",
        ),
      ).toEqual(["VALIDATION_EMAIL"]);
    });

    it("rejects invalid username formats with username validation keys", () => {
      const base = { email: "lemon@example.com", fullName: "Nguyen Van Lemon" };

      // Too short
      expect(messagesFor(createUserSchema, { ...base, username: "ab" }, "username")).toEqual([
        "VALIDATION_USERNAME_MIN|min=3",
        "VALIDATION_USERNAME_FORMAT",
      ]);

      // Too long
      expect(
        messagesFor(createUserSchema, { ...base, username: "a".repeat(31) }, "username"),
      ).toEqual(["VALIDATION_USERNAME_MAX|max=30", "VALIDATION_USERNAME_FORMAT"]);

      // Special characters
      expect(
        messagesFor(createUserSchema, { ...base, username: "lemon@user" }, "username"),
      ).toEqual(["VALIDATION_USERNAME_FORMAT"]);
    });

    it("rejects invalid fullName length with full name validation keys", () => {
      const base = { email: "lemon@example.com", username: "lemon_user" };

      // Too short
      expect(messagesFor(createUserSchema, { ...base, fullName: "A" }, "fullName")).toEqual([
        "VALIDATION_FULL_NAME_MIN|min=2",
      ]);

      // Too long
      expect(
        messagesFor(createUserSchema, { ...base, fullName: "A".repeat(101) }, "fullName"),
      ).toEqual(["VALIDATION_FULL_NAME_MAX|max=100"]);
    });

    it("rejects empty passwordHash with VALIDATION_PASSWORD_HASH_REQUIRED", () => {
      expect(
        messagesFor(
          createUserSchema,
          {
            email: "lemon@example.com",
            username: "lemon_user",
            fullName: "Nguyen Van Lemon",
            passwordHash: "",
          },
          "passwordHash",
        ),
      ).toEqual(["VALIDATION_PASSWORD_HASH_REQUIRED", "VALIDATION_ACCOUNT_CREDENTIALS_REQUIRED"]);
    });

    it("rejects invalid avatarUrl with VALIDATION_URL and bio over 500 with VALIDATION_BIO_MAX", () => {
      const base = {
        email: "lemon@example.com",
        username: "lemon_user",
        fullName: "Nguyen Van Lemon",
        passwordHash: "argon2id$mockhash",
      };

      expect(
        messagesFor(createUserSchema, { ...base, avatarUrl: "not-a-url" }, "avatarUrl"),
      ).toEqual(["VALIDATION_URL"]);
      expect(messagesFor(createUserSchema, { ...base, bio: "a".repeat(501) }, "bio")).toEqual([
        "VALIDATION_BIO_MAX|max=500",
      ]);
    });
  });

  describe("updateUserSchema", () => {
    it("validates and trims fullName if provided", () => {
      const parsed = updateUserSchema.parse({
        fullName: "  Updated Name  ",
        bio: "Just a lemon",
      });

      expect(parsed.fullName).toBe("Updated Name");
      expect(parsed.bio).toBe("Just a lemon");
    });

    it("rejects invalid avatar URLs with VALIDATION_URL", () => {
      expect(messagesFor(updateUserSchema, { avatarUrl: "not-a-valid-url" }, "avatarUrl")).toEqual([
        "VALIDATION_URL",
      ]);
    });

    it("rejects bio longer than 500 characters with VALIDATION_BIO_MAX", () => {
      expect(messagesFor(updateUserSchema, { bio: "a".repeat(501) }, "bio")).toEqual([
        "VALIDATION_BIO_MAX|max=500",
      ]);
    });
  });

  describe("changePasswordSchema", () => {
    it("accepts valid passwords", () => {
      const parsed = changePasswordSchema.parse({
        oldPassword: "old_password_123",
        newPassword: "new_password_123",
      });
      expect(parsed.newPassword).toBe("new_password_123");
    });

    it("rejects empty old password with VALIDATION_OLD_PASSWORD_REQUIRED", () => {
      expect(
        messagesFor(
          changePasswordSchema,
          { oldPassword: "", newPassword: "123456" },
          "oldPassword",
        ),
      ).toEqual(["VALIDATION_OLD_PASSWORD_REQUIRED"]);
    });

    it("rejects short new passwords (< 6 chars) with VALIDATION_NEW_PASSWORD_MIN", () => {
      expect(
        messagesFor(
          changePasswordSchema,
          { oldPassword: "old_password_123", newPassword: "12345" },
          "newPassword",
        ),
      ).toEqual(["VALIDATION_NEW_PASSWORD_MIN|min=6"]);
    });
  });

  describe("updatePasswordHashSchema", () => {
    it("rejects empty passwordHash with VALIDATION_PASSWORD_HASH_REQUIRED", () => {
      expect(messagesFor(updatePasswordHashSchema, { passwordHash: "" })).toEqual([
        "VALIDATION_PASSWORD_HASH_REQUIRED",
      ]);
    });
  });

  describe("toUserResponse mapper", () => {
    it("safely maps User to UserResponseDto without exposing passwordHash or deletedAt", () => {
      const now = new Date();
      const mockUser: User = {
        id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        email: "lemon@example.com",
        passwordHash: "argon2id$hashed",
        googleId: "google-123",
        username: "lemon_user",
        fullName: "Nguyen Van Lemon",
        avatarUrl: null,
        bio: "Hello world",
        phone: null,
        emailVerifiedAt: now,
        lastSeenAt: now,
        isActive: true,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const response = toUserResponse(mockUser);

      expect(response).toEqual({
        id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        email: "lemon@example.com",
        username: "lemon_user",
        fullName: "Nguyen Van Lemon",
        avatarUrl: null,
        bio: "Hello world",
        phone: null,
        emailVerifiedAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Verify no sensitive fields exist on the mapped object
      expect("passwordHash" in response).toBe(false);
      expect("googleId" in response).toBe(false);
      expect("deletedAt" in response).toBe(false);
    });
  });
});
