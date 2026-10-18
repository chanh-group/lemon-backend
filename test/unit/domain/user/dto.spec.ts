import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
} from "../../../../src/domain/user/dto/request.js";
import { toUserResponse } from "../../../../src/domain/user/dto/mapper.js";
import type { User } from "../../../../src/domain/user/schema.js";

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

    it("rejects when neither passwordHash nor googleId is provided", () => {
      expect(() =>
        createUserSchema.parse({
          email: "lemon@example.com",
          username: "lemon_user",
          fullName: "Nguyen Van Lemon",
        }),
      ).toThrow();
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

    it("rejects invalid email formats", () => {
      expect(() =>
        createUserSchema.parse({
          email: "not-an-email",
          username: "lemon_user",
          fullName: "Nguyen Van Lemon",
        }),
      ).toThrow();
    });

    it("rejects invalid username formats", () => {
      // Too short
      expect(() =>
        createUserSchema.parse({
          email: "lemon@example.com",
          username: "ab",
          fullName: "Nguyen Van Lemon",
        }),
      ).toThrow();

      // Special characters
      expect(() =>
        createUserSchema.parse({
          email: "lemon@example.com",
          username: "lemon@user",
          fullName: "Nguyen Van Lemon",
        }),
      ).toThrow();
    });

    it("rejects invalid fullName length", () => {
      // Too short
      expect(() =>
        createUserSchema.parse({
          email: "lemon@example.com",
          username: "lemon_user",
          fullName: "A",
        }),
      ).toThrow();
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

    it("rejects invalid avatar URLs", () => {
      expect(() =>
        updateUserSchema.parse({
          avatarUrl: "not-a-valid-url",
        }),
      ).toThrow();
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

    it("rejects short new passwords (< 6 chars)", () => {
      expect(() =>
        changePasswordSchema.parse({
          oldPassword: "old_password_123",
          newPassword: "12345",
        }),
      ).toThrow();
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
