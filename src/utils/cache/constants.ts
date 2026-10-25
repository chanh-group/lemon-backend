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

// Chat attachment upload limits (< 25MB)
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
export const CHAT_ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
export const CHAT_ALLOWED_VIDEO_MIME = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
] as const;
export const CHAT_ALLOWED_AUDIO_MIME = [
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-m4a",
] as const;
export const DISALLOWED_FILE_EXTENSIONS = [
  "exe",
  "bat",
  "cmd",
  "sh",
  "msi",
  "dll",
  "com",
  "vbs",
  "ps1",
  "scr",
] as const;

// Note feed key and lifetime settings.
export const NOTE_FEED_KEY_PREFIX = "notes:feed:";
export const NOTE_FEED_TTL_SECS = 60; // 1 minute — per-viewer note feed tray cache
export const NOTE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — note lifetime

// Purge job: leader lock so only one instance sweeps expired stories/notes.
export const PURGE_LOCK_KEY = "lock:purge-stories-notes";
export const PURGE_LOCK_TTL_SECS = 60;
export const PURGE_CRON_EXPRESSION = "*/5 * * * *";
export const PURGE_BATCH_LIMIT = 500;

// Unread counters: rebuilt from the DB on cache miss, cached for 7 days.
export const UNREAD_TTL_SECONDS = 604_800;

// Realtime presence: per-user state key TTL, disconnect grace window, and the
// remaining-TTL threshold above which another node is still heartbeating.
export const PRESENCE_TTL_SECONDS = 90;
export const PRESENCE_GRACE_MS = 60_000;
export const PRESENCE_OTHER_NODE_TTL_SECONDS = 30;

// ioredis client tuning (mirrors Rust ConnectionManager timeouts).
export const REDIS_COMMAND_TIMEOUT_MS = 2000;
export const REDIS_MAX_RETRIES_PER_REQUEST = 2;
export const REDIS_RECONNECT_DELAY_BASE_MS = 100;
export const REDIS_RECONNECT_DELAY_MAX_MS = 3000;
export const DEFAULT_REDIS_URL = "redis://localhost:6379";
export const OFFLINE_PRESENCE_TTL_SECONDS = 7 * 24 * 60 * 60;
