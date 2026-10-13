// Cache TTLs, key prefixes and limits — ported from Rust `dsa/src/config/constants.rs`.
// Values are part of the auth contract (refresh rotation, OTP, session eviction);
// do not change them without updating the spec.

export const CACHE_EXPIRATION = 60; // 1 minute — read-through profile/summary cache
export const REFRESH_TOKEN_EXPIRATION = 7 * 24 * 60 * 60; // 7 days
export const OTP_EXPIRATION = 2 * 60; // 2 minutes

export const MAX_OTP_ATTEMPTS = 5;
export const MAX_SESSIONS_PER_USER = 5;

export const REFRESH_TOKEN_KEY_PREFIX = "refreshToken:";
export const SESSION_KEY_PREFIX = "sessions:";
export const USER_CACHE_KEY_PREFIX = "user:";
export const GROUP_SUMMARY_KEY_PREFIX = "group_summary:";
export const GROUP_MEMBERS_KEY_PREFIX = "group:members:";
export const OTP_KEY_PREFIX = "otp:";
export const FORGOT_OTP_KEY_PREFIX = "forgot_otp:";

// ioredis client tuning (mirrors Rust ConnectionManager timeouts).
export const REDIS_COMMAND_TIMEOUT_MS = 2000;
export const REDIS_MAX_RETRIES_PER_REQUEST = 2;
