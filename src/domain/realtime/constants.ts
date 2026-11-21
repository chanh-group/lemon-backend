// Realtime timing constants — single source of truth for gateway tuning.
// Do not inline these values at call sites (see AGENTS.md "no magic values").

// A Redis failure must persist for this long before all sockets are forcibly
// disconnected; the debounce gives transient faults time to recover.
export const REDIS_DISCONNECT_GRACE_MS = 5_000;

// Typing indicator liveness window — the Redis typing key expires unless
// refreshed by continued keystrokes.
export const TYPING_TTL_SECS = 3;

export const CALL_DISCONNECT_HANDLER = Symbol("CALL_DISCONNECT_HANDLER");

export interface CallDisconnectHandler {
  handleUserDisconnect(userId: string): Promise<void>;
  handleUserReconnect(userId: string): Promise<void>;
}
