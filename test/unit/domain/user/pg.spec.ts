import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { UserPgRepository } from "../../../../src/domain/user/pg.js";
import type { User } from "../../../../src/domain/user/schema.js";

describe("UserPgRepository", () => {
  let repository: UserPgRepository;
  let mockDb: unknown;

  const mockUser: User = {
    id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
    email: "lemon@example.com",
    passwordHash: "argon2id$hashed",
    googleId: null,
    username: "lemon_user",
    fullName: "Nguyen Van Lemon",
    avatarUrl: null,
    bio: null,
    phone: null,
    emailVerifiedAt: new Date(),
    lastSeenAt: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    };
    repository = new UserPgRepository(mockDb as DrizzleDb);
  });

  describe("findById", () => {
    it("returns user entity when found", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce([mockUser]),
      };
      vi.mocked((mockDb as { select: ReturnType<typeof vi.fn> }).select).mockReturnValueOnce(
        selectChain,
      );

      const result = await repository.findById(mockUser.id);
      expect(result).toEqual(mockUser);
    });

    it("returns null when user is not found", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce([]),
      };
      vi.mocked((mockDb as { select: ReturnType<typeof vi.fn> }).select).mockReturnValueOnce(
        selectChain,
      );

      const result = await repository.findById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("findByEmail", () => {
    it("lowercases email and queries db", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce([mockUser]),
      };
      vi.mocked((mockDb as { select: ReturnType<typeof vi.fn> }).select).mockReturnValueOnce(
        selectChain,
      );

      const result = await repository.findByEmail("LEMON@example.COM");
      expect(result).toEqual(mockUser);
    });
  });

  describe("findByUsername", () => {
    it("lowercases username and queries db", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce([mockUser]),
      };
      vi.mocked((mockDb as { select: ReturnType<typeof vi.fn> }).select).mockReturnValueOnce(
        selectChain,
      );

      const result = await repository.findByUsername("LEMON_USER");
      expect(result).toEqual(mockUser);
    });
  });

  describe("findByIdentifier", () => {
    it("queries by identifier and returns user", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce([mockUser]),
      };
      vi.mocked((mockDb as { select: ReturnType<typeof vi.fn> }).select).mockReturnValueOnce(
        selectChain,
      );

      const result = await repository.findByIdentifier("lemon@example.com");
      expect(result).toEqual(mockUser);
    });
  });

  describe("create", () => {
    it("inserts user and returns created user", async () => {
      const insertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValueOnce([mockUser]),
      };
      vi.mocked((mockDb as { insert: ReturnType<typeof vi.fn> }).insert).mockReturnValueOnce(
        insertChain,
      );

      const result = await repository.create({
        email: "lemon@example.com",
        username: "lemon_user",
        fullName: "Nguyen Van Lemon",
      });

      expect(result).toEqual(mockUser);
    });
  });

  describe("updatePasswordHash", () => {
    it("updates password hash and updated_at", async () => {
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce(undefined),
      };
      vi.mocked((mockDb as { update: ReturnType<typeof vi.fn> }).update).mockReturnValueOnce(
        updateChain,
      );

      await expect(repository.updatePasswordHash(mockUser.id, "new_hash")).resolves.toBeUndefined();
    });
  });

  describe("updateProfile", () => {
    it("updates profile and returns updated user", async () => {
      const updatedUser = { ...mockUser, fullName: "New Full Name" };
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValueOnce([updatedUser]),
      };
      vi.mocked((mockDb as { update: ReturnType<typeof vi.fn> }).update).mockReturnValueOnce(
        updateChain,
      );

      const result = await repository.updateProfile(mockUser.id, { fullName: "New Full Name" });
      expect(result).toEqual(updatedUser);
    });
  });

  describe("updateLastSeen", () => {
    it("updates lastSeenAt", async () => {
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce(undefined),
      };
      vi.mocked((mockDb as { update: ReturnType<typeof vi.fn> }).update).mockReturnValueOnce(
        updateChain,
      );

      await expect(repository.updateLastSeen(mockUser.id)).resolves.toBeUndefined();
    });
  });

  describe("softDelete", () => {
    it("sets deletedAt and updatedAt", async () => {
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValueOnce(undefined),
      };
      vi.mocked((mockDb as { update: ReturnType<typeof vi.fn> }).update).mockReturnValueOnce(
        updateChain,
      );

      await expect(repository.softDelete(mockUser.id)).resolves.toBeUndefined();
    });
  });
});
