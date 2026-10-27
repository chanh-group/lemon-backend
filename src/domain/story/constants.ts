export const STORY_MAX_CAPTION_LENGTH = 500;
export const STORY_MAX_BACKGROUND_LENGTH = 200;

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
