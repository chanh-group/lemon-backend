import { describe, expect, it, vi } from "vitest";
import { UserController } from "../../../../src/domain/user/controller.js";
import type { UserService } from "../../../../src/domain/user/service.js";
import type { User } from "../../../../src/domain/user/schema.js";

describe("UserController", () => {
  const mockUser: User = {
    id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
    email: "lemon@example.com",
    username: "lemon_user",
    fullName: "Lemon User",
    avatarUrl: "https://example.com/avatar.jpg",
    bio: "Test bio",
    phone: null,
    passwordHash: "hash",
    googleId: null,
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T12:00:00Z"),
    isActive: true,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const findByUsername = vi.fn();
  const findByEmail = vi.fn();

  const mockUserService = {
    findByUsername,
    findByEmail,
  } as unknown as UserService;

  const controller = new UserController(mockUserService);

  describe("getByUsername", () => {
    it("returns mapped user when found", async () => {
      findByUsername.mockResolvedValueOnce(mockUser);

      const res = await controller.getByUsername("@lemon_user");
      expect(findByUsername).toHaveBeenCalledWith("lemon_user");
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: expect.objectContaining({
          id: mockUser.id,
          username: "lemon_user",
        }),
      });
    });

    it("returns null when user not found", async () => {
      findByUsername.mockResolvedValueOnce(null);

      const res = await controller.getByUsername("unknown");
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: null,
      });
    });
  });

  describe("getByEmail", () => {
    it("returns mapped user when found", async () => {
      findByEmail.mockResolvedValueOnce(mockUser);

      const res = await controller.getByEmail(" lemon@example.com ");
      expect(findByEmail).toHaveBeenCalledWith("lemon@example.com");
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: expect.objectContaining({
          id: mockUser.id,
          username: "lemon_user",
        }),
      });
    });

    it("returns null when user not found", async () => {
      findByEmail.mockResolvedValueOnce(null);

      const res = await controller.getByEmail("unknown@example.com");
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: null,
      });
    });
  });
});
