import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../../../../src/domain/auth/guards/authguard.js";
import { JwtConfig } from "../../../../../src/domain/auth/jwt.js";
import { BusinessError } from "../../../../../src/utils/errors/business.js";

async function expectUnauthorized(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BusinessError);
  expect((error as BusinessError).code).toBe("UNAUTHORIZED");
}

describe("AuthGuard", () => {
  const originalEnv = process.env;
  const mockSecret = "super_secret_jwt_key_at_least_32_bytes_long_12345";
  let guard: AuthGuard;
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: mockSecret };
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    guard = new AuthGuard(reflector as unknown as Reflector, JwtConfig.from_env());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function createMockContext(headers: Record<string, string>): {
    context: ExecutionContext;
    request: { headers: Record<string, string>; user?: { id: string } };
  } {
    const request = { headers, user: undefined };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it("allows request immediately when route is marked as @Public()", async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);
    const { context } = createMockContext({});

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it("throws BusinessError UNAUTHORIZED when authorization header is missing", async () => {
    const { context } = createMockContext({});
    await expectUnauthorized(guard.canActivate(context));
  });

  it("throws BusinessError UNAUTHORIZED when authorization header is not Bearer format", async () => {
    const { context } = createMockContext({ authorization: "Basic 123456" });
    await expectUnauthorized(guard.canActivate(context));
  });

  it("throws BusinessError UNAUTHORIZED when token is invalid or corrupted", async () => {
    const { context } = createMockContext({ authorization: "Bearer invalid.jwt.token" });
    await expectUnauthorized(guard.canActivate(context));
  });

  it("throws BusinessError UNAUTHORIZED when token type is refresh instead of access", async () => {
    const secretKey = new TextEncoder().encode(mockSecret);
    const token = await new jose.SignJWT({ type: "refresh", jti: "uuid-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuer("lemon-chat")
      .setAudience("lemon-chat-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey);

    const { context } = createMockContext({ authorization: `Bearer ${token}` });
    await expectUnauthorized(guard.canActivate(context));
  });

  it("allows request and sets request.user when token is valid access token", async () => {
    const secretKey = new TextEncoder().encode(mockSecret);
    const token = await new jose.SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-456")
      .setIssuer("lemon-chat")
      .setAudience("lemon-chat-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey);

    const { context, request } = createMockContext({ authorization: `Bearer ${token}` });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toEqual({ id: "user-456" });
  });
});
