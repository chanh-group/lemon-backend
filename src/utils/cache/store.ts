// Cache access contract — ported from Rust `dsa/src/utils/cache/store.rs`
// (`CacheStore` + `CacheStoreExt`).
//
// Every method is async because the Redis backend is real network I/O; the
// in-memory backend keeps the same signature so both stay interchangeable
// behind the `CACHE_STORE` token.
import { Logger } from "@nestjs/common";
import type {
  NewRefreshSession,
  OtpCheckOutcome,
  RefreshRotation,
  RevokeRefreshSession,
  RotationOutcome,
} from "./types.js";

export const REDIS_CLIENT: unique symbol = Symbol("REDIS_CLIENT");
export const CACHE_STORE: unique symbol = Symbol("CACHE_STORE");

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
  /**
   * Atomic OTP check: a wrong attempt bumps the counter WITHOUT extending the
   * TTL. Rejects with `CacheError` on infra failure — never mistake it for a
   * wrong code (that would lock users out during infra flaps).
   */
  checkOtpCode(key: string, candidate: string, maxAttempts: number): Promise<OtpCheckOutcome>;
}

export abstract class CacheStoreExt implements CacheStore {
  protected readonly logger = new Logger("Cache");

  abstract getRaw(key: string): Promise<string | null>;
  abstract setRaw(key: string, value: string, expirationSecs: number): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract deleteMany(keys: string[]): Promise<void>;
  abstract rotateRefreshToken(rotation: RefreshRotation): Promise<RotationOutcome>;
  abstract createRefreshSession(session: NewRefreshSession): Promise<void>;
  abstract revokeRefreshSession(revoke: RevokeRefreshSession): Promise<void>;
  abstract checkOtpCode(
    key: string,
    candidate: string,
    maxAttempts: number,
  ): Promise<OtpCheckOutcome>;

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
