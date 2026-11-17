// Cache access contract — ported from Rust `dsa/src/utils/cache/store.rs`
// (`CacheStore` + `CacheStoreExt`).
//
// Every method is async because the Redis backend is real network I/O; the
// in-memory backend keeps the same signature so both stay interchangeable
// behind the `CACHE_STORE` token.
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  FEED_FILL_LEASE_SECS,
  FEED_FILL_POLL_ATTEMPTS,
  FEED_FILL_POLL_INTERVAL_MS,
} from "./constants.js";
import { feedFillKey } from "./keys.js";
import type {
  NewRefreshSession,
  OtpCheckOutcome,
  RefreshRotation,
  RevokeRefreshSession,
  RotationOutcome,
} from "./types.js";

export const REDIS_CLIENT: unique symbol = Symbol("REDIS_CLIENT");
export const CACHE_STORE: unique symbol = Symbol("CACHE_STORE");

/** Timer-backed wait for feed-fill polling only (bounded, never unbounded). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface CacheStore {
  /** Raw string read. Rejects with `CacheError` on infra failure — critical callers fail closed (503). */
  getRaw(key: string): Promise<string | null>;
  /** Raw string write with TTL in seconds. Rejects with `CacheError` on infra failure. */
  setRaw(key: string, value: string, expirationSecs: number): Promise<void>;
  /** Idempotent delete (missing keys still resolve). Rejects with `CacheError` on infra failure. */
  delete(key: string): Promise<void>;
  /** Batch delete. Rejects with `CacheError` on infra failure. */
  deleteMany(keys: string[]): Promise<void>;
  /**
   * Atomic refresh rotation: subject check + old-key delete + new-key write +
   * sessions update. Rejects with `CacheError` on infra failure — callers must
   * fail closed and MUST NOT mistake it for `RotationOutcome.Stale` (that turns
   * an outage into mass logout).
   */
  rotateRefreshToken(rotation: RefreshRotation): Promise<RotationOutcome>;
  /**
   * Create a new refresh session, evicting the oldest past `maxSessions`.
   * Rejects with `CacheError` on infra failure — a signed-but-unsaved token is
   * useless and must never reach the client.
   */
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  /**
   * Revoke one session (single-session sign-out), keeping the sessions list's
   * remaining TTL. Rejects with `CacheError` on infra failure — never report a
   * fake "signed out".
   */
  revokeRefreshSession(revoke: RevokeRefreshSession): Promise<void>;
  revokeRefreshFamily(sessionKey: string, extraKeys: string[]): Promise<void>;
  /**
   * Atomic OTP check: a wrong attempt bumps the counter WITHOUT extending the
   * TTL. Rejects with `CacheError` on infra failure — never mistake it for a
   * wrong code (that would lock users out during infra flaps).
   */
  checkOtpCode(
    key: string,
    candidate: string,
    maxAttempts: number,
    consume?: boolean,
  ): Promise<OtpCheckOutcome>;
  /** Atomic lock acquire (`SET NX EX`). Rejects with `CacheError` on infra failure. */
  tryAcquireLock(key: string, token: string, expirationSecs: number): Promise<boolean>;
  /** Owner-safe release (compare-and-del). Stale token = silent no-op. Rejects with `CacheError` on infra failure. */
  releaseLock(key: string, token: string): Promise<void>;
}

export abstract class CacheStoreExt implements CacheStore {
  protected readonly logger = new Logger("Cache");

  /** Per-key in-flight `load` promises — the in-process stampede guard. */
  private readonly inFlightLoads = new Map<string, Promise<unknown>>();

  abstract getRaw(key: string): Promise<string | null>;
  abstract setRaw(key: string, value: string, expirationSecs: number): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract deleteMany(keys: string[]): Promise<void>;
  abstract rotateRefreshToken(rotation: RefreshRotation): Promise<RotationOutcome>;
  abstract createRefreshSession(session: NewRefreshSession): Promise<void>;
  abstract revokeRefreshSession(revoke: RevokeRefreshSession): Promise<void>;
  abstract revokeRefreshFamily(sessionKey: string, extraKeys: string[]): Promise<void>;
  abstract checkOtpCode(
    key: string,
    candidate: string,
    maxAttempts: number,
    consume?: boolean,
  ): Promise<OtpCheckOutcome>;
  abstract tryAcquireLock(key: string, token: string, expirationSecs: number): Promise<boolean>;
  abstract releaseLock(key: string, token: string): Promise<void>;
  abstract publishFeed(
    key: string,
    leaseKey: string,
    token: string,
    value: string,
    expirationSecs: number,
  ): Promise<void>;
  abstract invalidateFeeds(keys: string[]): Promise<void>;

  /**
   * Best-effort read-through feed fill with stampede protection. Concurrent
   * callers for one key share a single `load`; a lease miss polls for the lease
   * owner's published value (revived via `revive`, because JSON round-trips
   * turn `Date`s into strings) before falling back to a rebuild that does NOT
   * write the cache — only the lease owner publishes.
   */
  async loadFeedBestEffort<T>(
    key: string,
    expirationSecs: number,
    load: () => Promise<T>,
    revive?: (raw: unknown) => T,
  ): Promise<T> {
    const leaseKey = feedFillKey(key);
    const token = randomUUID();
    let acquired = false;
    try {
      acquired = await this.tryAcquireLock(leaseKey, token, FEED_FILL_LEASE_SECS);
    } catch (err) {
      this.logger.warn(`Feed cache lease unavailable: ${String(err)}`);
    }

    if (!acquired) {
      const filled = await this.awaitFeedFill<T>(key, revive);
      if (filled !== undefined) return filled;
      // The lease owner never published: correctness first — rebuild here, but
      // leave the cache write to the lease owner alone.
      return this.joinFeedLoad(key, load);
    }

    try {
      const value = await this.startFeedLoad(key, load);
      try {
        const serialized = JSON.stringify(value);
        if (serialized !== undefined)
          await this.publishFeed(key, leaseKey, token, serialized, expirationSecs);
      } catch (err) {
        this.logger.warn(`Feed cache write skipped: ${String(err)}`);
      }
      return value;
    } finally {
      try {
        await this.releaseLock(leaseKey, token);
      } catch (err) {
        this.logger.warn(`Feed cache lease release failed: ${String(err)}`);
      }
    }
  }

  /**
   * Poll for the lease owner's published value. Returns undefined when no
   * usable value appears within FEED_FILL_POLL_ATTEMPTS reads, so the caller
   * rebuilds without writing the cache.
   */
  private async awaitFeedFill<T>(
    key: string,
    revive: ((raw: unknown) => T) | undefined,
  ): Promise<T | undefined> {
    for (let attempt = 0; attempt < FEED_FILL_POLL_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(FEED_FILL_POLL_INTERVAL_MS);
      let raw: string | null;
      try {
        raw = await this.getRaw(key);
      } catch (err) {
        this.logger.warn(`Feed fill poll read skipped: ${String(err)}`);
        continue;
      }
      if (raw === null) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        return revive !== undefined ? revive(parsed) : (parsed as T);
      } catch (err) {
        this.logger.warn(`Feed fill poll value dropped: ${String(err)}`);
      }
    }
    return undefined;
  }

  /**
   * Start `load` as this key's shared in-flight load, replacing any stale
   * entry: after an invalidation or lease takeover a newer fill must not join
   * the abandoned one. The entry is dropped as soon as the load settles.
   */
  private startFeedLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const promise: Promise<T> = load().finally(() => {
      // Only drop our own entry — a stale load must not evict its replacement.
      if (this.inFlightLoads.get(key) === promise) this.inFlightLoads.delete(key);
    });
    this.inFlightLoads.set(key, promise);
    return promise;
  }

  /**
   * Join the in-flight shared load for `key` (single-flight) or start one when
   * none is running, so concurrent cold misses trigger a single rebuild.
   */
  private joinFeedLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inFlightLoads.get(key);
    // Every key is loaded with one concrete `T`; the map stays heterogeneous.
    if (pending !== undefined) return pending as Promise<T>;
    return this.startFeedLoad(key, load);
  }

  async invalidateFeedsBestEffort(keys: string[]): Promise<void> {
    try {
      await this.invalidateFeeds(keys);
    } catch (err) {
      this.logger.warn(`Feed cache invalidation skipped: ${String(err)}`);
    }
  }

  /** Read + JSON-deserialize. Corrupt entries are deleted and treated as miss. */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Dropping corrupt cache entry (treated as miss): ${key}`);
      await this.delete(key);
      return null;
    }
  }

  /** JSON-serialize + write with TTL in seconds. Unserializable values are skipped with a warn. */
  async set<T>(key: string, value: T, expirationSecs: number): Promise<void> {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) {
      this.logger.warn(`Skipping cache write (unserializable value): ${key}`);
      return;
    }
    await this.setRaw(key, serialized, expirationSecs);
  }

  /** Best-effort read for non-critical cache: infra failure → miss + warn, caller falls back to DB. */
  async getBestEffort<T>(key: string): Promise<T | null> {
    try {
      return await this.get<T>(key);
    } catch (err) {
      this.logger.warn(`Best-effort cache read missed: ${String(err)}`);
      return null;
    }
  }

  /** Best-effort write for non-critical cache: infra failure → skip + warn. */
  async setBestEffort<T>(key: string, value: T, expirationSecs: number): Promise<void> {
    try {
      await this.set(key, value, expirationSecs);
    } catch (err) {
      this.logger.warn(`Best-effort cache write skipped: ${String(err)}`);
    }
  }

  /** Best-effort delete for non-critical invalidation: infra failure → skip + warn. */
  async deleteBestEffort(key: string): Promise<void> {
    try {
      await this.delete(key);
    } catch (err) {
      this.logger.warn(`Best-effort cache delete skipped: ${String(err)}`);
    }
  }

  /** Best-effort batch delete for non-critical invalidation. */
  async deleteManyBestEffort(keys: string[]): Promise<void> {
    try {
      await this.deleteMany(keys);
    } catch (err) {
      this.logger.warn(`Best-effort cache batch delete skipped: ${String(err)}`);
    }
  }
}
