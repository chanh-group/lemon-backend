export {
  DEFAULT_PAGE_SIZE as DEFAULT_CALL_PAGE_SIZE,
  MAX_PAGE_SIZE as MAX_CALL_PAGE_SIZE,
} from "../pagination.constants.js";

export const CALL_RING_TIMEOUT_MS = 45_000; // 45 seconds ringing timeout
export const CALL_DISCONNECT_GRACE_MS = 15_000; // 15 seconds network reconnect grace period
export const CALL_ACTIVE_LOCK_TTL_SECONDS = 60; // Redis lock TTL for active call
export const METERED_ICE_CACHE_TTL_SECONDS = 43_200; // 12 hours cache for Metered TURN credentials

export const DEFAULT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
