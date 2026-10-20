export const ACCESS_TOKEN_EXPIRATION_SECS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRATION_SECS = 7 * 24 * 60 * 60; // 7 days
export const DEFAULT_JWT_ISSUER = "lemon-chat";
export const DEFAULT_JWT_AUDIENCE = "lemon-chat-client";
export const JWT_ALGORITHM = "HS256" as const;
export const JWT_LEEWAY_SECS = 30;
export const MIN_JWT_SECRET_LEN = 32; // bytes — boot fails below this (HS256 brute-force threshold)

export const JWT_CONFIG: unique symbol = Symbol("JWT_CONFIG");

export const REFRESH_COOKIE_NAME = "refreshCookie";
export const REFRESH_COOKIE_PATH = "/";

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
