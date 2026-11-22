// Realtime literals — single source of truth for gateway/service tuning and
// wire names. Do not inline these values at call sites (see AGENTS.md
// "no magic values").

import { TYPING_TTL_SECONDS } from "../../utils/cache/constants.js";

// A Redis failure must persist for this long before all sockets are forcibly
// disconnected; the debounce gives transient faults time to recover.
export const REDIS_DISCONNECT_GRACE_MS = 5_000;

// Typing indicator liveness window — the Redis typing key expires unless
// refreshed by continued keystrokes. Derived from the cache-level constant so
// both names share one source of truth.
export const TYPING_TTL_SECS = TYPING_TTL_SECONDS;

// Value stored in the Redis typing key — a presence marker, never parsed.
export const TYPING_KEY_VALUE = "1";

// Offline recheck delay after another node's heartbeat TTL lapses; the padding
// absorbs TTL/round-trip skew before the retry.
export const PRESENCE_RETRY_PADDING_MS = 1_000;

// Socket.io subscribe names (client → server).
export const SUBSCRIBE_EVENTS = {
  CONV_JOIN: "conv:join",
  CONV_LEAVE: "conv:leave",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  PRESENCE_PING: "presence:ping",
} as const;

// Socket.io emit names (server → client).
export const REALTIME_EVENTS = {
  READY: "ready",
  ERROR: "error",
  TYPING: "typing",
  MESSAGE_CORRELATED: "message:correlated",
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_REVOKED: "message:revoked",
  MESSAGE_HIDDEN: "message:hidden",
  READ_UPDATED: "read:updated",
  MESSAGE_REACTION: "message:reaction",
  FRIEND_REQUEST_NEW: "friend:request:new",
  FRIEND_REQUEST_CANCELLED: "friend:request:cancelled",
  FRIEND_REQUEST_ACCEPTED: "friend:request:accepted",
  FRIEND_REQUEST_DECLINED: "friend:request:declined",
  FRIEND_REMOVED: "friend:removed",
  STORY_REACTION: "story:reaction",
  STORY_REACTION_REMOVED: "story:reaction:removed",
} as const;

// Error payloads emitted on the `error` event.
export const SOCKET_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_PARTICIPANT: "NOT_PARTICIPANT",
} as const;

// ioredis lifecycle events: FAILURE events are debounced into a forced socket
// disconnect; a RECOVERY event cancels the pending one.
export const REDIS_LIFECYCLE_EVENTS = {
  FAILURE: ["close", "end", "reconnecting", "error"],
  RECOVERY: ["ready", "connect"],
} as const;
