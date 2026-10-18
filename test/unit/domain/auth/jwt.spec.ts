import * as jose from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JwtConfig } from "../../../../src/domain/auth/jwt.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

const VALID_SECRET = "super_secret_jwt_key_at_least_32_bytes_long_12345";
const OTHER_SECRET = "another_super_secret_jwt_key_min_32_bytes_long_67890";
const ACCESS_TOKEN_TTL_SECS = 15 * 60;
const REFRESH_TOKEN_TTL_SECS = 7 * 24 * 60 * 60;

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

describe("JwtConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("from_env throws when JWT_SECRET is not set", () => {
    vi.stubEnv("JWT_SECRET", undefined);

    expect(() => JwtConfig.from_env()).toThrow("JWT_SECRET is required but was not set");
  });

  it("from_env throws with the actual byte length when JWT_SECRET is too short", () => {
    vi.stubEnv("JWT_SECRET", "short");

    expect(() => JwtConfig.from_env()).toThrow("JWT_SECRET is 5 bytes, minimum is 32 bytes");
  });

  it("roundtrips access and refresh tokens with the expected payload shape and TTLs", async () => {
    vi.stubEnv("JWT_SECRET", VALID_SECRET);
    vi.stubEnv("JWT_ISSUER", undefined);
    vi.stubEnv("JWT_AUDIENCE", undefined);
    const config = JwtConfig.from_env();

    const accessToken = await config.signAccessToken("user-123");
    const access = await config.verifyAccessToken(accessToken);
    expect(access.sub).toBe("user-123");
    expect(access.type).toBe("access");
    expect(access.iss).toBe("lemon-chat");
    expect(access.aud).toBe("lemon-chat-client");
    expect(Number(access.exp) - Number(access.iat)).toBeCloseTo(ACCESS_TOKEN_TTL_SECS, -1);

    const refreshToken = await config.signRefreshToken("user-123", "jti-456");
    const refresh = await config.verifyRefreshToken(refreshToken);
    expect(refresh.sub).toBe("user-123");
    expect(refresh.type).toBe("refresh");
    expect(refresh.jti).toBe("jti-456");
    expect(refresh.iss).toBe("lemon-chat");
    expect(refresh.aud).toBe("lemon-chat-client");
    expect(Number(refresh.exp) - Number(refresh.iat)).toBeCloseTo(REFRESH_TOKEN_TTL_SECS, -1);
  });

  it("verifyRefreshToken rejects an access token with BusinessError INVALID_SESSION", async () => {
    vi.stubEnv("JWT_SECRET", VALID_SECRET);
    const config = JwtConfig.from_env();

    const accessToken = await config.signAccessToken("user-123");

    await expectBusinessError(config.verifyRefreshToken(accessToken), "INVALID_SESSION");
  });

  it("rejects tokens signed with another secret, issuer, algorithm, or without exp", async () => {
    vi.stubEnv("JWT_SECRET", VALID_SECRET);
    vi.stubEnv("JWT_ISSUER", undefined);
    vi.stubEnv("JWT_AUDIENCE", undefined);
    const config = JwtConfig.from_env();

    vi.stubEnv("JWT_SECRET", OTHER_SECRET);
    const otherSecretConfig = JwtConfig.from_env();
    await expectBusinessError(
      config.verifyAccessToken(await otherSecretConfig.signAccessToken("user-123")),
      "UNAUTHORIZED",
    );

    vi.stubEnv("JWT_SECRET", VALID_SECRET);
    vi.stubEnv("JWT_ISSUER", "evil-issuer");
    const evilIssuerConfig = JwtConfig.from_env();
    await expectBusinessError(
      config.verifyAccessToken(await evilIssuerConfig.signAccessToken("user-123")),
      "UNAUTHORIZED",
    );

    const secretKey = new TextEncoder().encode(VALID_SECRET);
    const hs384Token = await new jose.SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS384" })
      .setSubject("user-123")
      .setIssuer("lemon-chat")
      .setAudience("lemon-chat-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretKey);
    await expectBusinessError(config.verifyAccessToken(hs384Token), "UNAUTHORIZED");

    const noExpToken = await new jose.SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuer("lemon-chat")
      .setAudience("lemon-chat-client")
      .setIssuedAt()
      .sign(secretKey);
    await expectBusinessError(config.verifyAccessToken(noExpToken), "UNAUTHORIZED");
  });
});
