export {
  DEFAULT_PAGE_SIZE as DEFAULT_CONVERSATION_PAGE_SIZE,
  MAX_PAGE_SIZE as MAX_CONVERSATION_PAGE_SIZE,
} from "../pagination.constants.js";

export const GROUP_MAX_MEMBERS = 10;
export const GROUP_MIN_INVITED_MEMBERS = 2;
export const GROUP_MAX_NAME_LENGTH = 80;

// Group avatar cleanup job retry policy: give up after this many attempts.
export const AVATAR_CLEANUP_MAX_ATTEMPTS = 5;
// Stored `last_error` is truncated to keep the row bounded.
export const AVATAR_CLEANUP_ERROR_MAX_LENGTH = 500;
