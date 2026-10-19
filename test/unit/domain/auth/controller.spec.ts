import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "../../../../src/domain/auth/controller.js";
import { RATE_LIMITER } from "../../../../src/domain/auth/constants.js";
import { AuthService } from "../../../../src/domain/auth/service.js";
import { UserService } from "../../../../src/domain/user/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

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

describe("AuthController", () => {
  let controller: AuthController;
  let authService: {
    requestOtp: ReturnType<typeof vi.fn>;
    verifyOtp: ReturnType<typeof vi.fn>;
    signup: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    forgotPasswordOtp: ReturnType<typeof vi.fn>;
    forgotPasswordReset: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>;
  };
  let userService: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockRes: {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };

  const mockUserResponse = {
    id: "usr-123",
    email: "lemon@example.com",
    username: "lemon",
    fullName: "Lemon Nguyen",
    avatarUrl: null,
    bio: null,
    phone: null,
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  beforeEach(() => {
    authService = {
      requestOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signup: vi.fn(),
      login: vi.fn(),
      refreshToken: vi.fn(),
      logout: vi.fn(),
      forgotPasswordOtp: vi.fn(),
      forgotPasswordReset: vi.fn(),
      changePassword: vi.fn(),
    };

    userService = {
      findById: vi.fn(),
    };

    mockRes = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      userService as unknown as UserService,
    );
  });

  describe("requestOtp", () => {
    it("calls authService.requestOtp and returns the default vi success message", async () => {
      authService.requestOtp.mockResolvedValueOnce(undefined);
      const res = await controller.requestOtp({ email: "lemon@example.com" }, "vi");

      expect(authService.requestOtp).toHaveBeenCalledWith({ email: "lemon@example.com" });
      expect(res).toEqual({ success: true, message: "Đã gửi mã OTP" });
    });
  });

  describe("verifyOtp", () => {
    it("calls authService.verifyOtp and returns valid boolean with the vi message", async () => {
      authService.verifyOtp.mockResolvedValueOnce(true);
      const res = await controller.verifyOtp(
        {
          email: "lemon@example.com",
          otp: "123456",
          purpose: "signup",
        },
        "vi",
      );

      expect(authService.verifyOtp).toHaveBeenCalledWith({
        email: "lemon@example.com",
        otp: "123456",
        purpose: "signup",
      });
      expect(res).toEqual({
        success: true,
        message: "Mã OTP hợp lệ",
        data: { valid: true },
      });
    });
  });

  describe("signup", () => {
    it("calls authService.signup and returns created user with the vi message", async () => {
      authService.signup.mockResolvedValueOnce(mockUserResponse);
      const payload = {
        email: "lemon@example.com",
        fullName: "Lemon Nguyen",
        username: "lemon",
        password: "Password#123",
        otp: "123456",
      };

      const res = await controller.signup(payload, "vi");
      expect(authService.signup).toHaveBeenCalledWith(payload);
      expect(res).toEqual({
        success: true,
        message: "Tạo tài khoản thành công",
        data: mockUserResponse,
      });
    });
  });

  describe("login", () => {
    it("calls authService.login, sets refresh token cookie, and returns access token + user", async () => {
      authService.login.mockResolvedValueOnce({
        tokens: {
          accessToken: "access-token-123",
          refreshToken: "refresh-token-456",
        },
        user: mockUserResponse,
      });

      const res = await controller.login(
        { identifier: "lemon", password: "Password#123" },
        "vi",
        mockRes as unknown as Response,
      );

      expect(authService.login).toHaveBeenCalledWith({
        identifier: "lemon",
        password: "Password#123",
      });
      expect(mockRes.cookie).toHaveBeenCalledWith(
        "refreshCookie",
        "refresh-token-456",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "strict",
          path: "/",
        }),
      );
      expect(res).toEqual({
        success: true,
        message: "Đăng nhập thành công",
        data: {
          accessToken: "access-token-123",
          user: mockUserResponse,
        },
      });
    });
  });

  describe("refresh", () => {
    it("throws BusinessError UNAUTHORIZED if no refresh cookie", async () => {
      const mockReq = { cookies: {}, headers: {} } as unknown as Request;

      await expectBusinessError(
        controller.refresh(mockReq, mockRes as unknown as Response, "vi"),
        "UNAUTHORIZED",
      );
    });

    it("extracts refresh token from cookies, rotates token, sets new cookie, and returns new access token", async () => {
      const mockReq = {
        cookies: { refreshCookie: "valid-refresh-token" },
        headers: {},
      } as unknown as Request;

      authService.refreshToken.mockResolvedValueOnce({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      });

      const res = await controller.refresh(mockReq, mockRes as unknown as Response, "vi");

      expect(authService.refreshToken).toHaveBeenCalledWith("valid-refresh-token");
      expect(mockRes.cookie).toHaveBeenCalledWith(
        "refreshCookie",
        "new-refresh-token",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "strict",
          path: "/",
        }),
      );
      expect(res).toEqual({
        success: true,
        message: "Đã cấp token mới",
        data: { accessToken: "new-access-token" },
      });
    });

    it("rejects when refresh cookie is missing (no header fallback)", async () => {
      const mockReq = {
        cookies: {},
        headers: { "x-refresh-token": "header-refresh-token" },
      } as unknown as Request;

      await expect(
        controller.refresh(mockReq, mockRes as unknown as Response, "vi"),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(authService.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("calls authService.logout with cookie token and clears cookie", async () => {
      const mockReq = {
        cookies: { refreshCookie: "token-to-logout" },
        headers: {},
      } as unknown as Request;

      const res = await controller.logout(mockReq, mockRes as unknown as Response, "vi");

      expect(authService.logout).toHaveBeenCalledWith("token-to-logout");
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        "refreshCookie",
        expect.objectContaining({
          httpOnly: true,
          path: "/",
        }),
      );
      expect(res).toEqual({ success: true, message: "Đăng xuất thành công" });
    });
  });

  describe("forgot-password", () => {
    it("forgotPasswordOtp calls authService and returns the vi message", async () => {
      const res = await controller.forgotPasswordOtp({ email: "lemon@example.com" }, "vi");
      expect(authService.forgotPasswordOtp).toHaveBeenCalledWith({ email: "lemon@example.com" });
      expect(res).toEqual({
        success: true,
        message: "Đã gửi mã OTP",
      });
    });

    it("forgotPasswordReset calls authService and returns the vi message", async () => {
      const res = await controller.forgotPasswordReset(
        {
          email: "lemon@example.com",
          otp: "654321",
          newPassword: "NewPassword#123",
        },
        "vi",
      );
      expect(authService.forgotPasswordReset).toHaveBeenCalledWith({
        email: "lemon@example.com",
        otp: "654321",
        newPassword: "NewPassword#123",
      });
      expect(res).toEqual({ success: true, message: "Đặt lại mật khẩu thành công" });
    });
  });

  describe("changePassword", () => {
    it("calls authService.changePassword, clears cookie, and returns the vi message", async () => {
      const res = await controller.changePassword(
        { id: "usr-123" },
        { oldPassword: "OldPassword#123", newPassword: "NewPassword#123" },
        mockRes as unknown as Response,
        "vi",
      );

      expect(authService.changePassword).toHaveBeenCalledWith("usr-123", {
        oldPassword: "OldPassword#123",
        newPassword: "NewPassword#123",
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        "refreshCookie",
        expect.objectContaining({
          httpOnly: true,
          path: "/",
        }),
      );
      expect(res).toEqual({
        success: true,
        message: "Đổi mật khẩu thành công",
      });
    });
  });

  describe("boot validation", () => {
    it("fails fast when COOKIE_SAMESITE=none without COOKIE_SECURE=true", () => {
      vi.stubEnv("COOKIE_SAMESITE", "none");
      vi.stubEnv("COOKIE_SECURE", "false");
      try {
        expect(
          () =>
            new AuthController(
              authService as unknown as AuthService,
              userService as unknown as UserService,
            ),
        ).toThrowError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("getMe", () => {
    it("returns mapped user profile if found with the vi message", async () => {
      userService.findById.mockResolvedValueOnce({
        id: "usr-123",
        email: "lemon@example.com",
        username: "lemon",
        fullName: "Lemon Nguyen",
        passwordHash: "hash-secret",
        avatarUrl: null,
        bio: null,
        phone: null,
        emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
        lastSeenAt: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const res = await controller.getMe({ id: "usr-123" }, "vi");
      expect(userService.findById).toHaveBeenCalledWith("usr-123");
      expect(res.message).toBe("Tìm thấy người dùng");
      expect(res.data.id).toBe("usr-123");
      expect(res.data.email).toBe("lemon@example.com");
      expect((res.data as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
    });

    it("throws BusinessError USER_NOT_FOUND if user not found", async () => {
      userService.findById.mockResolvedValueOnce(null);
      await expectBusinessError(
        controller.getMe({ id: "usr-non-existent" }, "vi"),
        "USER_NOT_FOUND",
      );
    });
  });

  describe("HTTP request path (@Lang wiring)", () => {
    let app: INestApplication<App>;
    let httpAuthService: {
      requestOtp: ReturnType<typeof vi.fn>;
      verifyOtp: ReturnType<typeof vi.fn>;
      signup: ReturnType<typeof vi.fn>;
      login: ReturnType<typeof vi.fn>;
      refreshToken: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
      forgotPasswordOtp: ReturnType<typeof vi.fn>;
      forgotPasswordReset: ReturnType<typeof vi.fn>;
      changePassword: ReturnType<typeof vi.fn>;
    };
    let httpUserService: {
      findById: ReturnType<typeof vi.fn>;
    };
    const httpRateLimiter = {
      checkIpLimit: vi.fn().mockResolvedValue(true),
      checkEmailLimit: vi.fn().mockResolvedValue(true),
      checkMixedLimit: vi.fn().mockResolvedValue(true),
    };

    beforeAll(async () => {
      httpAuthService = {
        requestOtp: vi.fn(),
        verifyOtp: vi.fn(),
        signup: vi.fn(),
        login: vi.fn(),
        refreshToken: vi.fn(),
        logout: vi.fn(),
        forgotPasswordOtp: vi.fn(),
        forgotPasswordReset: vi.fn(),
        changePassword: vi.fn(),
      };
      httpUserService = { findById: vi.fn() };

      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: httpAuthService },
          { provide: UserService, useValue: httpUserService },
          { provide: RATE_LIMITER, useValue: httpRateLimiter },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(standardSchemaPipe());
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it("resolves @Lang() to vi when no accept-language header is sent", async () => {
      httpAuthService.verifyOtp.mockResolvedValueOnce(true);

      const response = await request(app.getHttpServer())
        .post("/auth/verify-otp")
        .send({ email: "lemon@example.com", otp: "123456", purpose: "signup" })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: "Mã OTP hợp lệ",
        data: { valid: true },
      });
    });

    it("resolves @Lang() from accept-language: en for login", async () => {
      httpAuthService.login.mockResolvedValueOnce({
        tokens: { accessToken: "access-token-123", refreshToken: "refresh-token-456" },
        user: mockUserResponse,
      });

      const response = await request(app.getHttpServer())
        .post("/auth/login")
        .set("accept-language", "en")
        .send({ identifier: "lemon", password: "Password#123" })
        .expect(200);

      expect(response.body.message).toBe("Signed in successfully");
      expect(response.body.data.accessToken).toBe("access-token-123");
      expect(response.body.data.user.id).toBe("usr-123");
    });

    it("keeps signup at 201 and resolves the vi message through the wire", async () => {
      httpAuthService.signup.mockResolvedValueOnce(mockUserResponse);

      const response = await request(app.getHttpServer())
        .post("/auth/signup")
        .send({
          email: "lemon@example.com",
          fullName: "Lemon Nguyen",
          username: "lemon",
          password: "Password#123",
          otp: "123456",
        })
        .expect(201);

      expect(response.body.message).toBe("Tạo tài khoản thành công");
      expect(response.body.data.id).toBe("usr-123");
    });
  });
});
