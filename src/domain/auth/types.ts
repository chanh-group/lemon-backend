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
