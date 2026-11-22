// Presence bookkeeping for connected users: per-user connection counts,
// disconnect grace timers, and the last presence state this node wrote.
// Extracted from ChatGateway — must never import gateway.ts / service.ts
// (no cycles).
import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import {
  OFFLINE_PRESENCE_TTL_SECONDS,
  PRESENCE_GRACE_MS,
  PRESENCE_OTHER_NODE_TTL_SECONDS,
  PRESENCE_TTL_SECONDS,
} from "../../utils/cache/constants.js";
import { presenceOnlineKey, presenceUserKey } from "../../utils/cache/keys.js";
import type { UserService } from "../user/service.js";
import { PRESENCE_RETRY_PADDING_MS } from "./constants.js";

const logger = new Logger("ChatGateway");

/** What this node last wrote to a user's presence state key. */
export type WrittenPresence = { state: "online"; conns: number } | { state: "offline" };

/** EXPIRE reports 0 when the key is gone — the caller must rebuild the state key. */
function presenceKeyMissing(results: [Error | null, unknown][] | null): boolean {
  const first = results?.[0] ?? null;
  if (first === null) return false;
  const [err, value] = first;
  return err === null && value === 0;
}

export class PresenceTracker {
  // Track active connection counts per user: userId -> socket count
  private readonly userConnections = new Map<string, number>();
  // Track disconnect/offline recheck timers: userId -> timer
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Last written presence state per user: pings skip full writes when unchanged
  private readonly presenceWrites = new Map<string, WrittenPresence>();

  constructor(
    private readonly userService: UserService,
    private readonly redis: Redis | null,
  ) {}

  /**
   * Count a new connection (cancelling a pending offline grace timer) and
   * write full online presence. Returns the user's active connection count.
   */
  async registerConnection(userId: string): Promise<number> {
    // Cancel grace period timer if reconnecting
    const existingTimer = this.graceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.graceTimers.delete(userId);
    }

    const currentConns = (this.userConnections.get(userId) ?? 0) + 1;
    this.userConnections.set(userId, currentConns);

    await this.setOnlinePresence(userId, currentConns);
    return currentConns;
  }

  /**
   * Drop one connection. When the last one goes, schedule the offline grace
   * timer (a reconnect within the window cancels it). Returns the remaining
   * connection count (≤ 0 when the user fully disconnected).
   */
  registerDisconnection(userId: string): number {
    const currentConns = (this.userConnections.get(userId) ?? 1) - 1;
    if (currentConns <= 0) {
      this.userConnections.delete(userId);

      // Start grace period before marking offline; a reconnect within the window cancels it
      const existingTimer = this.graceTimers.get(userId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        void this.finalizeOffline(userId);
      }, PRESENCE_GRACE_MS);
      timer.unref();

      this.graceTimers.set(userId, timer);
    } else {
      this.userConnections.set(userId, currentConns);
    }
    return currentConns;
  }

  /** `presence:ping` — refresh liveness for the user's current connection count. */
  async ping(userId: string): Promise<void> {
    await this.touchOnlinePresence(userId, this.userConnections.get(userId) ?? 1);
  }

  /**
   * Mark the user offline after the grace window — unless another node still
   * heartbeats the state key (then recheck after that heartbeat expires).
   */
  async finalizeOffline(userId: string): Promise<void> {
    this.graceTimers.delete(userId);

    // Another node still heartbeats when the state key has a healthy remaining TTL —
    // leave the user online (the reconnect may also have refreshed presence meanwhile).
    if (this.redis) {
      try {
        const ttl = await this.redis.ttl(presenceUserKey(userId));
        if (ttl > PRESENCE_OTHER_NODE_TTL_SECONDS) {
          logger.log(
            `Presence offline deferred for ${userId}: another node may still heartbeat (ttl ${ttl}s)`,
          );
          const retryDelayMs =
            (ttl - PRESENCE_OTHER_NODE_TTL_SECONDS) * 1000 + PRESENCE_RETRY_PADDING_MS;
          const timer = setTimeout(() => {
            void this.finalizeOffline(userId);
          }, retryDelayMs);
          timer.unref();
          this.graceTimers.set(userId, timer);
          return;
        }
      } catch (err) {
        logger.warn(`Presence TTL check failed for ${userId}: ${String(err)}`);
      }
    }

    await Promise.all([this.setOfflinePresence(userId), this.touchLastSeen(userId)]);
    logger.log(`User marked offline after ${PRESENCE_GRACE_MS / 1000}s grace: ${userId}`);
  }

  /** Clear every timer and cached connection/presence state. */
  shutdown(): void {
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();
    this.userConnections.clear();
    this.presenceWrites.clear();
  }

  private async touchLastSeen(userId: string): Promise<void> {
    try {
      await this.userService.updateLastSeen(userId);
    } catch (err) {
      logger.warn(`Failed to touch lastSeen for ${userId}: ${String(err)}`);
    }
  }

  /** Full presence write (SET + ZADD) and record what was written. */
  private async setOnlinePresence(userId: string, conns: number): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis
        .pipeline()
        .set(
          presenceUserKey(userId),
          JSON.stringify({ state: "online", lastSeen: now, conns }),
          "EX",
          PRESENCE_TTL_SECONDS,
        )
        .zadd(presenceOnlineKey(), now, userId)
        .exec();
      this.presenceWrites.set(userId, { state: "online", conns });
    } catch (err) {
      logger.warn(`Failed to set online presence for ${userId}: ${String(err)}`);
    }
  }

  /**
   * Ping path: when the written state and connection count are unchanged, only
   * refresh liveness (EXPIRE + ZADD) instead of re-serializing the JSON.
   */
  private async touchOnlinePresence(userId: string, conns: number): Promise<void> {
    const written = this.presenceWrites.get(userId);
    if (written === undefined || written.state !== "online" || written.conns !== conns) {
      await this.setOnlinePresence(userId, conns);
      return;
    }
    if (!this.redis) return;
    try {
      const now = Date.now();
      const results = await this.redis
        .pipeline()
        .expire(presenceUserKey(userId), PRESENCE_TTL_SECONDS)
        .zadd(presenceOnlineKey(), now, userId)
        .exec();
      if (presenceKeyMissing(results)) {
        // The state key expired since the last write — rebuild it in full.
        await this.setOnlinePresence(userId, conns);
      }
    } catch (err) {
      logger.warn(`Failed to refresh presence liveness for ${userId}: ${String(err)}`);
    }
  }

  private async setOfflinePresence(userId: string): Promise<void> {
    if (!this.redis) return;
    if (this.presenceWrites.get(userId)?.state === "offline") return;
    try {
      const now = Date.now();
      await this.redis
        .pipeline()
        .set(
          presenceUserKey(userId),
          JSON.stringify({ state: "offline", lastSeen: now }),
          "EX",
          OFFLINE_PRESENCE_TTL_SECONDS,
        )
        .zrem(presenceOnlineKey(), userId)
        .exec();
      this.presenceWrites.set(userId, { state: "offline" });
    } catch (err) {
      logger.warn(`Failed to set offline presence for ${userId}: ${String(err)}`);
    }
  }
}
