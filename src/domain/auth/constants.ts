export const OTP_LENGTH = 6;
// Digit-only OTP with exactly OTP_LENGTH digits — keep in sync with OTP_LENGTH.
export const OTP_REGEX = /^\d{6}$/;
export const OTP_VALUE_MIN = 10 ** (OTP_LENGTH - 1); // smallest OTP_LENGTH-digit number
export const OTP_VALUE_MAX = 10 ** OTP_LENGTH; // exclusive upper bound for randomInt
export const PASSWORD_MIN_LENGTH = 8;
export const ARGON2_HASH_LENGTH = 32;

export const ACCESS_TOKEN_EXPIRATION_SECS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRATION_SECS = 7 * 24 * 60 * 60; // 7 days
export const DEFAULT_JWT_ISSUER = "lemon-chat";
export const DEFAULT_JWT_AUDIENCE = "lemon-chat-client";
export const JWT_ALGORITHM = "HS256" as const;
export const JWT_LEEWAY_SECS = 30;
export const MIN_JWT_SECRET_LEN = 32; // bytes — boot fails below this (HS256 brute-force threshold)
export const AUTH_REVOCATION_CHANNEL = "lemon_auth_revoked";
export const AUTH_LISTENER_RETRY_MS = 2_000;
export const AUTH_LISTENER_CONNECT_TIMEOUT_MS = 5_000;

export const JWT_CONFIG: unique symbol = Symbol("JWT_CONFIG");

export const REFRESH_COOKIE_NAME = "refreshCookie";
export const REFRESH_COOKIE_PATH = "/";
// Access-token cookie read from the socket handshake (set by the frontend).
export const ACCESS_TOKEN_COOKIE_NAME = "lemon_access_token";

export {
  RATE_LIMIT_CHANGE_PASSWORD_IP_MAX,
  RATE_LIMIT_CHANGE_PASSWORD_USER_MAX,
  RATE_LIMIT_EMAIL_WINDOW_SECS,
  RATE_LIMIT_FORGOT_PASSWORD_OTP_IP_MAX,
  RATE_LIMIT_REQUEST_OTP_EMAIL_MAX,
  RATE_LIMIT_REQUEST_OTP_IP_MAX,
  RATE_LIMIT_SIGNIN_IP_MAX,
  RATE_LIMIT_VERIFY_OTP_IP_MAX,
  RATE_LIMIT_WINDOW_SECS,
} from "../../middleware/ratelimit.js";
export { RATE_LIMITER } from "../../middleware/ratelimit.js";
