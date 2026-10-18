// Centralized JWT config — ported from Rust `dsa/src/utils/jwt.rs` (`JwtConfig`).
//
// Single source of truth for the signing secret, sign/verify helpers and TTLs;
// `from_env()` fails fast at boot when `JWT_SECRET` is missing or too weak.
import { Buffer } from "node:buffer";
import * as jose from "jose";
import { get_env } from "../../helpers/index.js";
import { BusinessError } from "../../utils/errors/business.js";
import {
  ACCESS_TOKEN_EXPIRATION_SECS,
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ISSUER,
  JWT_ALGORITHM,
  JWT_LEEWAY_SECS,
  MIN_JWT_SECRET_LEN,
  REFRESH_TOKEN_EXPIRATION_SECS,
} from "./constants.js";
import type { AccessTokenPayload, RefreshTokenPayload } from "./types.js";

export class JwtConfig {
  readonly secret: string;
  private readonly secretKey: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  private constructor(secret: string, issuer: string, audience: string) {
    this.secret = secret;
    this.secretKey = new TextEncoder().encode(secret);
    this.issuer = issuer;
    this.audience = audience;
  }

  /**
   * Read JWT config from env, fail-closed: `JWT_SECRET` is required and must be
   * at least `MIN_JWT_SECRET_LEN` bytes — otherwise the process must not boot.
   * `JWT_ISSUER`/`JWT_AUDIENCE` keep defaults because they are not secrets.
   */
  static from_env(): JwtConfig {
    let secret: string;
    try {
      secret = get_env("JWT_SECRET");
    } catch {
      throw new Error("JWT_SECRET is required but was not set");
    }

    const secretBytes = Buffer.byteLength(secret, "utf8");
    if (secretBytes < MIN_JWT_SECRET_LEN) {
      throw new Error(`JWT_SECRET is ${secretBytes} bytes, minimum is ${MIN_JWT_SECRET_LEN} bytes`);
    }

    return new JwtConfig(
      secret,
      get_env("JWT_ISSUER", DEFAULT_JWT_ISSUER),
      get_env("JWT_AUDIENCE", DEFAULT_JWT_AUDIENCE),
    );
  }

  async signAccessToken(userId: string): Promise<string> {
    return new jose.SignJWT({ type: "access" })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_EXPIRATION_SECS}s`)
      .sign(this.secretKey);
  }

  async signRefreshToken(userId: string, jti: string): Promise<string> {
    return new jose.SignJWT({ type: "refresh", jti })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_EXPIRATION_SECS}s`)
      .sign(this.secretKey);
  }

  /**
   * Verify an access token. Pins HS256, issuer, audience, 30s clock tolerance
   * and requires exp/iss/aud; rejects wrong `type`. Errors stay opaque
   * (`UNAUTHORIZED`) so callers never leak verification details.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;
    try {
      const verified = await jose.jwtVerify<AccessTokenPayload>(token, this.secretKey, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: JWT_LEEWAY_SECS,
        requiredClaims: ["exp", "iss", "aud"],
      });
      payload = verified.payload;
    } catch {
      throw new BusinessError("UNAUTHORIZED");
    }

    if (payload.type !== "access" || !payload.sub) {
      throw new BusinessError("UNAUTHORIZED");
    }

    return payload;
  }

  /**
   * Verify a refresh token with the same pinned validation as access tokens,
   * plus a `refresh` type check and mandatory `jti`/`sub`. Rejects with
   * `INVALID_SESSION` so refresh/logout flows map cleanly to a session error.
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      const verified = await jose.jwtVerify<RefreshTokenPayload>(token, this.secretKey, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: JWT_LEEWAY_SECS,
        requiredClaims: ["exp", "iss", "aud"],
      });
      payload = verified.payload;
    } catch {
      throw new BusinessError("INVALID_SESSION");
    }

    if (payload.type !== "refresh" || !payload.jti || !payload.sub) {
      throw new BusinessError("INVALID_SESSION");
    }

    return payload;
  }
}
