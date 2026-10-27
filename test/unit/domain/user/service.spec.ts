import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRepository } from "../../../../src/domain/user/repository.js";
import type { User } from "../../../../src/domain/user/schema.js";
import { UserService } from "../../../../src/domain/user/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

async function expectBusinessError(
  promise: Promise<unknown>,
  code: BusinessError["code"],
): Promise<BusinessError> {
  const error: unknown = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BusinessError);
  const businessError = error as BusinessError;
  expect(businessError.code).toBe(code);
  return businessError;
}

type MockRepo = {
  findById: ReturnType<typeof vi.fn>;
  findByEmail: ReturnType<typeof vi.fn>;
  findByUsername: ReturnType<typeof vi.fn>;
  findByIdentifier: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updatePasswordHash: ReturnType<typeof vi.fn>;
  updateProfile: ReturnType<typeof vi.fn>;
  updateLastSeen: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
};

describe("UserService", () => {
  let service: UserService;
  let mockRepo: MockRepo;

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
    mockRepo = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      findByUsername: vi.fn(),
      findByIdentifier: vi.fn(),
      create: vi.fn(),
      updatePasswordHash: vi.fn(),
      updateProfile: vi.fn(),
      updateLastSeen: vi.fn(),
      softDelete: vi.fn(),
    };

    service = new UserService(mockRepo as unknown as UserRepository);
  });

  describe("findById", () => {
    it("returns user when found", async () => {
      mockRepo.findById.mockResolvedValueOnce(mockUser);

      const result = await service.findById(mockUser.id);
      expect(result).toBe(mockUser);
      expect(mockRepo.findById).toHaveBeenCalledWith(mockUser.id);
    });

    it("returns null when not found", async () => {
      mockRepo.findById.mockResolvedValueOnce(null);

      const result = await service.findById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("findByEmail", () => {
    it("calls repo.findByEmail with provided email", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(mockUser);

      const result = await service.findByEmail("lemon@example.com");
      expect(result).toBe(mockUser);
      expect(mockRepo.findByEmail).toHaveBeenCalledWith("lemon@example.com");
    });
  });

  describe("findByUsername", () => {
    it("calls repo.findByUsername with provided username", async () => {
      mockRepo.findByUsername.mockResolvedValueOnce(mockUser);

      const result = await service.findByUsername("lemon_user");
      expect(result).toBe(mockUser);
      expect(mockRepo.findByUsername).toHaveBeenCalledWith("lemon_user");
    });
  });

  describe("findByIdentifier", () => {
    it("calls repo.findByIdentifier with identifier", async () => {
      mockRepo.findByIdentifier.mockResolvedValueOnce(mockUser);

      const result = await service.findByIdentifier("lemon@example.com");
      expect(result).toBe(mockUser);
      expect(mockRepo.findByIdentifier).toHaveBeenCalledWith("lemon@example.com");
    });
  });

  describe("create", () => {
    const validDto = {
      email: "lemon@example.com",
      username: "lemon_user",
      fullName: "Nguyen Van Lemon",
      passwordHash: "argon2id$hashed",
    };

    it("successfully creates and returns user when data is valid and unique", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(null);
      mockRepo.findByUsername.mockResolvedValueOnce(null);
      mockRepo.create.mockResolvedValueOnce(mockUser);

      const result = await service.create(validDto);
      expect(result).toBe(mockUser);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "lemon@example.com",
          username: "lemon_user",
          fullName: "Nguyen Van Lemon",
        }),
      );
    });

    it("throws USER_ALREADY_EXISTS when email already exists", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(mockUser);

      await expect(service.create(validDto)).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });
    });

    it("throws USERNAME_TAKEN when username already exists", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(null);
      mockRepo.findByUsername.mockResolvedValueOnce(mockUser);

      await expect(service.create(validDto)).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    });

    it("throws BusinessError VALIDATION_ERROR with non-empty issues when payload fails zod validation", async () => {
      const error = await expectBusinessError(
        service.create({
          email: "invalid-email",
          username: "le",
          fullName: "",
        }),
        "VALIDATION_ERROR",
      );

      expect(error.issues?.length).toBeGreaterThan(0);
      expect(error.issues?.map((issue) => issue.path)).toContain("email");
    });

    it("maps 23505 duplicate email errors to CONFLICT", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(null);
      mockRepo.findByUsername.mockResolvedValueOnce(null);
      mockRepo.create.mockRejectedValueOnce({
        code: "23505",
        constraint: "users_email_uq",
      });

      await expect(service.create(validDto)).rejects.toBeInstanceOf(BusinessError);
    });

    it("maps 23505 duplicate username errors to CONFLICT", async () => {
      mockRepo.findByEmail.mockResolvedValueOnce(null);
      mockRepo.findByUsername.mockResolvedValueOnce(null);
      mockRepo.create.mockRejectedValueOnce({
        code: "23505",
        constraint: "users_username_uq",
      });

      await expect(service.create(validDto)).rejects.toMatchObject({
        code: "CONFLICT",
        rawMessage: undefined,
      });
    });
  });

  describe("getProfile", () => {
    it("returns safe UserResponseDto when user exists", async () => {
      mockRepo.findById.mockResolvedValueOnce(mockUser);

      const result = await service.getProfile(mockUser.id);
      expect(result.id).toBe(mockUser.id);
      expect(result.email).toBe(mockUser.email);
      expect(result.username).toBe(mockUser.username);
      expect("passwordHash" in result).toBe(false);
    });

    it("throws BusinessError USER_NOT_FOUND when user does not exist", async () => {
      mockRepo.findById.mockResolvedValueOnce(null);

      await expectBusinessError(service.getProfile("not-found"), "USER_NOT_FOUND");
    });
  });

  describe("updateProfile", () => {
    it("successfully updates and returns profile", async () => {
      const updatedUser = { ...mockUser, fullName: "New Full Name" };
      mockRepo.updateProfile.mockResolvedValueOnce(updatedUser);

      const result = await service.updateProfile(mockUser.id, {
        fullName: "New Full Name",
      });

      expect(result.fullName).toBe("New Full Name");
      expect(mockRepo.updateProfile).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ fullName: "New Full Name" }),
      );
    });

    it("throws BusinessError USER_NOT_FOUND when user to update does not exist", async () => {
      mockRepo.updateProfile.mockResolvedValueOnce(null);

      await expectBusinessError(
        service.updateProfile("not-found", { fullName: "New Name" }),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("updatePasswordHash", () => {
    it("calls repo.updatePasswordHash", async () => {
      await service.updatePasswordHash(mockUser.id, "new$hash");
      expect(mockRepo.updatePasswordHash).toHaveBeenCalledWith(mockUser.id, "new$hash");
    });
  });

  describe("updateLastSeen", () => {
    it("calls repo.updateLastSeen", async () => {
      const now = new Date();
      await service.updateLastSeen(mockUser.id, now);
      expect(mockRepo.updateLastSeen).toHaveBeenCalledWith(mockUser.id, now);
    });
  });

  describe("softDelete", () => {
    it("calls repo.softDelete", async () => {
      await service.softDelete(mockUser.id);
      expect(mockRepo.softDelete).toHaveBeenCalledWith(mockUser.id);
    });
  });
});
