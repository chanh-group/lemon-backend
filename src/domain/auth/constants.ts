export const ACCESS_TOKEN_EXPIRATION_SECS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRATION_SECS = 7 * 24 * 60 * 60; // 7 days
export const DEFAULT_JWT_ISSUER = "lemon-chat";
export const DEFAULT_JWT_AUDIENCE = "lemon-chat-client";
export const JWT_ALGORITHM = "HS256" as const;
export const JWT_LEEWAY_SECS = 30;

export const REFRESH_COOKIE_NAME = "refreshCookie";
export const REFRESH_COOKIE_PATH = "/auth";

export const OTP_PURPOSE_SIGNUP = "signup" as const;
export const OTP_PURPOSE_RESET = "reset" as const;
