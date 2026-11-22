/** Stable marker stored in conversation previews; clients localize its display. */
export const ATTACHMENT_PREVIEW_TOKEN = "[attachment]";
/** Stable marker stored in conversation previews; clients localize its display. */
export const MESSAGE_REVOKED_PREVIEW_TOKEN = "[message-revoked]";
/** Stable marker for a story reaction in conversation previews. */
export const STORY_REACTION_PREVIEW_TOKEN = "[story-reaction]";
export const MESSAGE_MAX_BODY_LENGTH = 4000;
/** Truncated body stored in conversation previews (DB `left(m.body, …)` and app-side slice). */
export const MESSAGE_PREVIEW_LENGTH = 80;
export const MESSAGE_MAX_ATTACHMENTS = 10;
export const MESSAGE_OBJECT_KEY_MAX_LENGTH = 512;
export const MESSAGE_FILE_NAME_MAX_LENGTH = 255;
export const MESSAGE_MIME_TYPE_MAX_LENGTH = 255;
export const ATTACHMENT_URL_TTL_SECS = 86400;
export const ALLOWED_MESSAGE_REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡"] as const;
export type AllowedMessageReaction = (typeof ALLOWED_MESSAGE_REACTIONS)[number];
