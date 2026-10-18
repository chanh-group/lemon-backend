import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "../../../../src/domain/auth/controller.js";
import type { AuthService } from "../../../../src/domain/auth/service.js";
import type { UserService } from "../../../../src/domain/user/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

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
    it("calls authService.requestOtp and returns success message", async () => {
      authService.requestOtp.mockResolvedValueOnce(undefined);
      const res = await controller.requestOtp({ email: "lemon@example.com" }, "req-1");

      expect(authService.requestOtp).toHaveBeenCalledWith({ email: "lemon@example.com" }, "req-1");
      expect(res.message).toContain("Mã OTP xác thực đã được gửi");
    });
  });

  describe("verifyOtp", () => {
    it("calls authService.verifyOtp and returns valid boolean", async () => {
      authService.verifyOtp.mockResolvedValueOnce(true);
      const res = await controller.verifyOtp({
        email: "lemon@example.com",
        otp: "123456",
        purpose: "signup",
      });

      expect(authService.verifyOtp).toHaveBeenCalledWith({
        email: "lemon@example.com",
        otp: "123456",
        purpose: "signup",
      });
      expect(res).toEqual({ valid: true });
    });
  });

  describe("signup", () => {
    it("calls authService.signup and returns created user", async () => {
      authService.signup.mockResolvedValueOnce(mockUserResponse);
      const payload = {
        email: "lemon@example.com",
        fullName: "Lemon Nguyen",
        username: "lemon",
        password: "Password#123",
        otp: "123456",
      };

      const res = await controller.signup(payload);
      expect(authService.signup).toHaveBeenCalledWith(payload);
      expect(res).toEqual(mockUserResponse);
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
          path: "/auth",
        }),
      );
      expect(res).toEqual({
        accessToken: "access-token-123",
        user: mockUserResponse,
      });
    });
  });

  describe("refresh", () => {
    it("throws BusinessError UNAUTHORIZED if no refresh token in cookie or header", async () => {
      const mockReq = { cookies: {}, headers: {} } as unknown as Request;

      await expectBusinessError(
        controller.refresh(mockReq, mockRes as unknown as Response),
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

      const res = await controller.refresh(mockReq, mockRes as unknown as Response);

      expect(authService.refreshToken).toHaveBeenCalledWith("valid-refresh-token");
      expect(mockRes.cookie).toHaveBeenCalledWith(
        "refreshCookie",
        "new-refresh-token",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "strict",
          path: "/auth",
        }),
      );
      expect(res).toEqual({ accessToken: "new-access-token" });
    });

    it("falls back to x-refresh-token header if cookie is missing", async () => {
      const mockReq = {
        cookies: {},
        headers: { "x-refresh-token": "header-refresh-token" },
      } as unknown as Request;

      authService.refreshToken.mockResolvedValueOnce({
        accessToken: "new-access-token-header",
        refreshToken: "new-refresh-token-header",
      });

      const res = await controller.refresh(mockReq, mockRes as unknown as Response);

      expect(authService.refreshToken).toHaveBeenCalledWith("header-refresh-token");
      expect(res).toEqual({ accessToken: "new-access-token-header" });
    });
  });

  describe("logout", () => {
    it("calls authService.logout with cookie token and clears cookie", async () => {
      const mockReq = {
        cookies: { refreshCookie: "token-to-logout" },
        headers: {},
      } as unknown as Request;

      const res = await controller.logout(mockReq, mockRes as unknown as Response);

      expect(authService.logout).toHaveBeenCalledWith("token-to-logout");
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        "refreshCookie",
        expect.objectContaining({
          httpOnly: true,
          path: "/auth",
        }),
      );
      expect(res.message).toBe("Đăng xuất thành công");
    });
  });

  describe("forgot-password", () => {
    it("forgotPasswordOtp calls authService and returns message", async () => {
      const res = await controller.forgotPasswordOtp(
        { email: "lemon@example.com" },
        "req-forgot-1",
      );
      expect(authService.forgotPasswordOtp).toHaveBeenCalledWith(
        { email: "lemon@example.com" },
        "req-forgot-1",
      );
      expect(res.message).toContain("mã OTP khôi phục đã được gửi");
    });

    it("forgotPasswordReset calls authService and returns message", async () => {
      const res = await controller.forgotPasswordReset({
        email: "lemon@example.com",
        otp: "654321",
        newPassword: "NewPassword#123",
      });
      expect(authService.forgotPasswordReset).toHaveBeenCalledWith({
        email: "lemon@example.com",
        otp: "654321",
        newPassword: "NewPassword#123",
      });
      expect(res.message).toContain("Đặt lại mật khẩu thành công");
    });
  });

  describe("changePassword", () => {
    it("calls authService.changePassword, clears cookie, and returns message", async () => {
      const res = await controller.changePassword(
        { id: "usr-123" },
        { oldPassword: "OldPassword#123", newPassword: "NewPassword#123" },
        mockRes as unknown as Response,
      );

      expect(authService.changePassword).toHaveBeenCalledWith("usr-123", {
        oldPassword: "OldPassword#123",
        newPassword: "NewPassword#123",
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        "refreshCookie",
        expect.objectContaining({
          httpOnly: true,
          path: "/auth",
        }),
      );
      expect(res.message).toContain("Đổi mật khẩu thành công");
    });
  });

  describe("getMe", () => {
    it("returns mapped user profile if found", async () => {
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

      const res = await controller.getMe({ id: "usr-123" });
      expect(userService.findById).toHaveBeenCalledWith("usr-123");
      expect(res.id).toBe("usr-123");
      expect(res.email).toBe("lemon@example.com");
      expect((res as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
    });

    it("throws BusinessError USER_NOT_FOUND if user not found", async () => {
      userService.findById.mockResolvedValueOnce(null);
      await expectBusinessError(controller.getMe({ id: "usr-non-existent" }), "USER_NOT_FOUND");
    });
  });
});
