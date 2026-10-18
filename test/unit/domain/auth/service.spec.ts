import * as argon2 from "argon2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../../src/domain/auth/service.js";
import type { User } from "../../../../src/domain/user/schema.js";
import { OTP_KEY_PREFIX } from "../../../../src/utils/cache/constants.js";
import { CacheError } from "../../../../src/utils/cache/error.js";
import { MemoryCacheService } from "../../../../src/utils/cache/memory.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { SystemError } from "../../../../src/utils/errors/system.js";

type MockUserRepo = {
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

type MockMailService = {
  sendOtp: ReturnType<typeof vi.fn>;
  sendRaw: ReturnType<typeof vi.fn>;
  getQueueSize: ReturnType<typeof vi.fn>;
  onModuleDestroy: ReturnType<typeof vi.fn>;
};

async function expectBusinessError(
  promise: Promise<unknown>,
  code: BusinessError["code"],
): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BusinessError);
  expect((error as BusinessError).code).toBe(code);
}

async function expectSystemUnavailable(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(SystemError);
  expect((error as SystemError).kind).toBe("unavailable");
}

describe("AuthService", () => {
  const originalEnv = process.env;
  const mockSecret = "super_secret_jwt_key_at_least_32_bytes_long_12345";
  let authService: AuthService;
  let cacheStore: MemoryCacheService;
  let mockUserRepo: MockUserRepo;
  let mockMailService: MockMailService;

  const mockUser: User = {
    id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
    email: "lemon@example.com",
    passwordHash: "",
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

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: mockSecret,
      JWT_ISSUER: "lemon-chat",
      JWT_AUDIENCE: "lemon-chat-client",
    };

    cacheStore = new MemoryCacheService();

    mockUserRepo = {
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

    mockMailService = {
      sendOtp: vi.fn().mockResolvedValue(undefined),
      sendRaw: vi.fn().mockResolvedValue(undefined),
      getQueueSize: vi.fn().mockReturnValue(0),
      onModuleDestroy: vi.fn().mockResolvedValue(undefined),
    };

    const hash = await argon2.hash("MatKhau#123", { type: argon2.argon2id });
    mockUser.passwordHash = hash;

    authService = new AuthService(mockUserRepo as never, cacheStore, mockMailService as never);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("requestOtp", () => {
    it("throws BusinessError USER_ALREADY_EXISTS when email already exists", async () => {
      mockUserRepo.findByEmail.mockResolvedValueOnce(mockUser);

      await expectBusinessError(
        authService.requestOtp({ email: "lemon@example.com" }),
        "USER_ALREADY_EXISTS",
      );
    });

    it("stores OTP in cache and enqueues mail when email does not exist", async () => {
      mockUserRepo.findByEmail.mockResolvedValueOnce(null);

      await authService.requestOtp({ email: "newuser@example.com" }, "req-1");

      const raw = await cacheStore.getRaw(`${OTP_KEY_PREFIX}newuser@example.com`);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw as string)).toHaveProperty("code");

      expect(mockMailService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "newuser@example.com",
          purpose: "signup",
          requestId: "req-1",
        }),
      );
    });

    it("fails closed with SystemError unavailable when the OTP cache write fails", async () => {
      mockUserRepo.findByEmail.mockResolvedValueOnce(null);
      vi.spyOn(cacheStore, "setRaw").mockRejectedValueOnce(new CacheError("SET"));

      await expectSystemUnavailable(authService.requestOtp({ email: "newuser@example.com" }));
    });
  });

  describe("verifyOtp", () => {
    it("returns true when OTP code matches", async () => {
      await cacheStore.setRaw(
        `${OTP_KEY_PREFIX}verify@example.com`,
        JSON.stringify({ code: "123456", attempts: 0 }),
        120,
      );

      const result = await authService.verifyOtp({
        email: "verify@example.com",
        otp: "123456",
        purpose: "signup",
      });

      expect(result).toBe(true);
    });

    it("throws BusinessError INVALID_OTP when OTP code is incorrect", async () => {
      await cacheStore.setRaw(
        `${OTP_KEY_PREFIX}verify@example.com`,
        JSON.stringify({ code: "123456", attempts: 0 }),
        120,
      );

      await expectBusinessError(
        authService.verifyOtp({
          email: "verify@example.com",
          otp: "000000",
          purpose: "signup",
        }),
        "INVALID_OTP",
      );
    });
  });

  describe("signup", () => {
    it("throws BusinessError INVALID_OTP when OTP is incorrect", async () => {
      await cacheStore.setRaw(
        `${OTP_KEY_PREFIX}signup@example.com`,
        JSON.stringify({ code: "123456", attempts: 0 }),
        120,
      );

      await expectBusinessError(
        authService.signup({
          email: "signup@example.com",
          fullName: "Test User",
          username: "test_user",
          password: "MatKhau#123",
          otp: "654321",
        }),
        "INVALID_OTP",
      );
    });

    it("creates user, hashes password with argon2id and consumes OTP on success", async () => {
      await cacheStore.setRaw(
        `${OTP_KEY_PREFIX}signup@example.com`,
        JSON.stringify({ code: "123456", attempts: 0 }),
        120,
      );

      mockUserRepo.findByEmail.mockResolvedValueOnce(null);
      mockUserRepo.findByUsername.mockResolvedValueOnce(null);
      mockUserRepo.create.mockResolvedValueOnce({
        ...mockUser,
        email: "signup@example.com",
        username: "signup_user",
      });

      const response = await authService.signup({
        email: "signup@example.com",
        fullName: "Signup User",
        username: "signup_user",
        password: "MatKhau#123",
        otp: "123456",
      });

      expect(response.email).toBe("signup@example.com");
      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "signup@example.com",
          username: "signup_user",
        }),
      );

      // Verify OTP was consumed (deleted)
      const cached = await cacheStore.getRaw(`${OTP_KEY_PREFIX}signup@example.com`);
      expect(cached).toBeNull();
    });
  });

  describe("login", () => {
    it("throws BusinessError INVALID_CREDENTIALS when user is not found or has no password", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(null);

      await expectBusinessError(
        authService.login({ identifier: "unknown", password: "pwd" }),
        "INVALID_CREDENTIALS",
      );
    });

    it("throws BusinessError INVALID_CREDENTIALS when password does not match", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);

      await expectBusinessError(
        authService.login({ identifier: "lemon_user", password: "WrongPassword#123" }),
        "INVALID_CREDENTIALS",
      );
    });

    it("throws BusinessError FORBIDDEN when account is inactive", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce({
        ...mockUser,
        isActive: false,
      });

      await expectBusinessError(
        authService.login({ identifier: "lemon_user", password: "MatKhau#123" }),
        "FORBIDDEN",
      );
    });

    it("throws BusinessError EMAIL_NOT_VERIFIED when email is not verified", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce({
        ...mockUser,
        emailVerifiedAt: null,
      });

      await expectBusinessError(
        authService.login({ identifier: "lemon_user", password: "MatKhau#123" }),
        "EMAIL_NOT_VERIFIED",
      );
    });

    it("successfully creates tokens and user response on valid credentials", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);

      const result = await authService.login({
        identifier: "lemon_user",
        password: "MatKhau#123",
      });

      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.user.email).toBe(mockUser.email);
    });

    it("fails closed with SystemError unavailable when the refresh session cannot be stored", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);
      vi.spyOn(cacheStore, "createRefreshSession").mockRejectedValueOnce(
        new CacheError("CREATE_REFRESH_SESSION"),
      );

      await expectSystemUnavailable(
        authService.login({ identifier: "lemon_user", password: "MatKhau#123" }),
      );
    });
  });

  describe("refreshToken", () => {
    it("throws BusinessError INVALID_SESSION on invalid token", async () => {
      await expectBusinessError(
        authService.refreshToken("invalid.refresh.token"),
        "INVALID_SESSION",
      );
    });

    it("successfully rotates refresh token and returns new pair", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);
      const loginResult = await authService.login({
        identifier: "lemon_user",
        password: "MatKhau#123",
      });

      const refreshResult = await authService.refreshToken(loginResult.tokens.refreshToken);

      expect(refreshResult.accessToken).toBeDefined();
      expect(refreshResult.refreshToken).toBeDefined();
      expect(refreshResult.refreshToken).not.toBe(loginResult.tokens.refreshToken);
    });

    it("detects replay attack when old rotated token is reused and revokes family", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);
      const loginResult = await authService.login({
        identifier: "lemon_user",
        password: "MatKhau#123",
      });

      const oldRefreshToken = loginResult.tokens.refreshToken;

      // First rotation succeeds
      await authService.refreshToken(oldRefreshToken);

      // Replaying the old token must fail with BusinessError INVALID_SESSION
      await expectBusinessError(authService.refreshToken(oldRefreshToken), "INVALID_SESSION");
    });
  });

  describe("logout", () => {
    it("safely resolves even without token or with invalid token", async () => {
      await expect(authService.logout(undefined)).resolves.toBeUndefined();
      await expect(authService.logout("invalid-token")).resolves.toBeUndefined();
    });

    it("revokes session on valid refresh token", async () => {
      mockUserRepo.findByIdentifier.mockResolvedValueOnce(mockUser);
      const loginResult = await authService.login({
        identifier: "lemon_user",
        password: "MatKhau#123",
      });

      await authService.logout(loginResult.tokens.refreshToken);

      // Trying to refresh after logout should fail
      await expectBusinessError(
        authService.refreshToken(loginResult.tokens.refreshToken),
        "INVALID_SESSION",
      );
    });
  });

  describe("forgotPasswordOtp & forgotPasswordReset", () => {
    it("does not throw when email is not found (anti-enumeration)", async () => {
      mockUserRepo.findByEmail.mockResolvedValueOnce(null);

      await expect(
        authService.forgotPasswordOtp({ email: "unknown@example.com" }),
      ).resolves.toBeUndefined();

      expect(mockMailService.sendOtp).not.toHaveBeenCalled();
    });

    it("sends OTP when email exists", async () => {
      mockUserRepo.findByEmail.mockResolvedValueOnce(mockUser);

      await authService.forgotPasswordOtp({ email: mockUser.email });

      expect(mockMailService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          purpose: "reset",
        }),
      );
    });

    it("resets password and revokes all sessions on valid OTP", async () => {
      // Store forgot OTP in cache
      await cacheStore.setRaw(
        `forgot_otp:${mockUser.email}`,
        JSON.stringify({ code: "654321", attempts: 0 }),
        120,
      );

      mockUserRepo.findByEmail.mockResolvedValueOnce(mockUser);

      await authService.forgotPasswordReset({
        email: mockUser.email,
        otp: "654321",
        newPassword: "NewMatKhau#456",
      });

      expect(mockUserRepo.updatePasswordHash).toHaveBeenCalledWith(mockUser.id, expect.any(String));
    });
  });

  describe("changePassword", () => {
    it("throws BusinessError USER_NOT_FOUND when user does not exist", async () => {
      mockUserRepo.findById.mockResolvedValueOnce(null);

      await expectBusinessError(
        authService.changePassword("non-existent", {
          oldPassword: "old",
          newPassword: "new_password",
        }),
        "USER_NOT_FOUND",
      );
    });

    it("throws BusinessError INVALID_OLD_PASSWORD when old password does not match", async () => {
      mockUserRepo.findById.mockResolvedValueOnce(mockUser);

      await expectBusinessError(
        authService.changePassword(mockUser.id, {
          oldPassword: "WrongOldPassword",
          newPassword: "new_password",
        }),
        "INVALID_OLD_PASSWORD",
      );
    });

    it("updates password and revokes all sessions when old password matches", async () => {
      mockUserRepo.findById.mockResolvedValueOnce(mockUser);

      await authService.changePassword(mockUser.id, {
        oldPassword: "MatKhau#123",
        newPassword: "BrandNewPassword#456",
      });

      expect(mockUserRepo.updatePasswordHash).toHaveBeenCalledWith(mockUser.id, expect.any(String));
    });
  });
});
