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
