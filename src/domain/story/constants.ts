export const STORY_MAX_CAPTION_LENGTH = 500;
export const STORY_MAX_BACKGROUND_LENGTH = 200;
export const STORY_MAX_DURATION_MS = 60_000;

/**
 * Emoji allowlist for story reactions — the quick-reaction bar of the client
 * renders exactly these, so the server never stores anything else.
 */
export const ALLOWED_STORY_EMOJIS = [
  "👍",
  "❤️",
  "🥰",
  "😆",
  "😂",
  "😮",
  "😢",
  "😡",
  "🔥",
  "👏",
] as const;

export type StoryEmoji = (typeof ALLOWED_STORY_EMOJIS)[number];

export const STORY_SILENT_LIKE_EMOJI = "❤️";

export const STORY_AUDIENCE_MODES = ["ALL_FRIENDS", "CUSTOM", "EXCLUDE"] as const;
export type StoryAudienceMode = (typeof STORY_AUDIENCE_MODES)[number];

export const STORY_REACTION_KINDS = ["REACTION", "LIKE"] as const;
export type StoryReactionKind = (typeof STORY_REACTION_KINDS)[number];

/** Viewer names disappear after 24h (Instagram model), aggregate view count remains (WhatsApp model). */
export const STORY_VIEWER_NAMES_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** SQL window for viewer identities; derived from STORY_VIEWER_NAMES_EXPIRY_MS. */
export const STORY_VIEWER_WINDOW_HOURS = STORY_VIEWER_NAMES_EXPIRY_MS / (60 * 60 * 1000);
/**
 * `stories_expiry_chk` DDL bound: STORY_VIEWER_WINDOW_HOURS TTL + 1h slack.
 * DDL check constraints cannot take bind params, hence the raw literal in schema.ts.
 */
export const STORY_EXPIRY_CHECK_HOURS = STORY_VIEWER_WINDOW_HOURS + 1;

/**
 * Upper bound of stories kept per author in the feed payload — bounds both the
 * SQL result and the cached feed so one prolific author cannot grow the
 * per-viewer feed cache entry without limit.
 */
export const STORY_FEED_MAX_PER_AUTHOR = 30;

/** Bounded S3 HEAD concurrency for measuring legacy media so an old account
 * cannot flood S3 with an unbounded Promise.all (throttle / connection spike). */
export const STORY_LEGACY_MEDIA_HEAD_CONCURRENCY = 32;

/** Max rows per `setMediaSizes` UPDATE ... VALUES statement. Each row is 2 bind
 * params; chunking keeps the statement well under PostgreSQL's parameter cap. */
export const STORY_MEDIA_SIZE_UPDATE_BATCH = 1000;

export const STORY_STORAGE_LIMIT_BYTES = 512 * 1024 * 1024;
