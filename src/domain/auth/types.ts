import type { JWTPayload } from "jose";

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  type: "access";
  iss: string;
  aud: string;
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string;
  type: "refresh";
  jti: string;
  iss: string;
  aud: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Authenticated identity attached to an HTTP request by AuthGuard. */
export interface AuthUser {
  id: string;
}
