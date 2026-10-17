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
export const OTP_KEY_PREFIX = "otp:";
export const FORGOT_OTP_KEY_PREFIX = "forgot_otp:";
export const STORY_FEED_KEY_PREFIX = "stories:feed:";

export const STORY_FEED_TTL_SECS = 60; // 1 minute — per-viewer feed tray cache
export const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — story lifetime
export const STORY_DEFAULT_BUCKET = "lemon-stories";
export const STORY_MAX_CAPTION_LENGTH = 500;

// Story media upload limits (single source used by presign AND verify).
export const STORY_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const STORY_MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
export const STORY_ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const STORY_ALLOWED_VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const MIME_EXTENSION_MAP: Record<string, string | undefined> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
export const S3_PRESIGN_TTL_SECS = 300;
export const S3_DELETE_BATCH_SIZE = 1000;

// Note domain TTLs/limits (24h expiry, 200 char limit).
export const NOTE_FEED_KEY_PREFIX = "notes:feed:";
export const NOTE_FEED_TTL_SECS = 60; // 1 minute — per-viewer note feed tray cache
export const NOTE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — note lifetime
export const NOTE_MAX_CONTENT_LENGTH = 200;

// Purge job: leader lock so only one instance sweeps expired stories/notes.
export const PURGE_LOCK_KEY = "lock:purge-stories-notes";
export const PURGE_LOCK_TTL_SECS = 60;
export const PURGE_CRON_EXPRESSION = "*/5 * * * *";
export const PURGE_BATCH_LIMIT = 500;

// ioredis client tuning (mirrors Rust ConnectionManager timeouts).
export const REDIS_COMMAND_TIMEOUT_MS = 2000;
export const REDIS_MAX_RETRIES_PER_REQUEST = 2;
