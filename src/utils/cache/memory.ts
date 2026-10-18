// In-memory cache backend for tests and Redis-less local dev.
// Mirrors Redis semantics (TTL, sessions JSON, KEEPTTL on wrong OTP) but fully
// synchronous: no await between steps, so it is race-free in a single-threaded
// test runtime. Redis Lua is the real multi-process atomicity.
// Ported from Rust `dsa/src/utils/cache/memory.rs`.
import { Injectable } from "@nestjs/common";
import { REFRESH_TOKEN_KEY_PREFIX } from "./constants.js";
import { CacheStoreExt } from "./store.js";
import {
  OtpCheckOutcome,
  RotationOutcome,
  type NewRefreshSession,
  type OtpEntry,
  type RefreshRotation,
  type RevokeRefreshSession,
} from "./types.js";

@Injectable()
export class MemoryCacheService extends CacheStoreExt {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  /** Live read (expired entries are purged). Sync — RAM only. */
  private readLive(key: string): string | null {
    const entry = this.store.get(key);
    if (entry === undefined) return null;
    if (Date.now() < entry.expiresAt) return entry.value;
    this.store.delete(key);
    return null;
  }

  /** Parse the sessions list; corrupt means empty (like Lua `pcall`). */
  private static parseSessions(raw: string | null): string[] {
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  /** Overwrite the value but keep the remaining TTL (Redis `KEEPTTL` equivalent). */
  private overwriteKeepTtl(key: string, value: string): void {
    const entry = this.store.get(key);
    if (entry !== undefined) {
      this.store.set(key, { value, expiresAt: entry.expiresAt });
    }
  }

  async getRaw(key: string): Promise<string | null> {
    return this.readLive(key);
  }

  async setRaw(key: string, value: string, expirationSecs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + expirationSecs * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  async rotateRefreshToken(rotation: RefreshRotation): Promise<RotationOutcome> {
    const stored = this.readLive(rotation.oldKey);
    if (stored === null || stored !== rotation.subject) {
      return RotationOutcome.Stale;
    }
    this.store.delete(rotation.oldKey);
    await this.setRaw(rotation.newKey, rotation.subject, rotation.ttlSecs);
    const sessions = MemoryCacheService.parseSessions(this.readLive(rotation.sessionKey));
    const updated = sessions.filter((jti) => jti !== rotation.oldJti);
    updated.push(rotation.newJti);
    await this.setRaw(rotation.sessionKey, JSON.stringify(updated), rotation.ttlSecs);
    return RotationOutcome.Rotated;
  }

  async createRefreshSession(session: NewRefreshSession): Promise<void> {
    const sessions = MemoryCacheService.parseSessions(this.readLive(session.sessionKey));
    sessions.push(session.jti);
    if (sessions.length > session.maxSessions) {
      const evicted = sessions.splice(0, sessions.length - session.maxSessions);
      for (const jti of evicted) {
        this.store.delete(`${REFRESH_TOKEN_KEY_PREFIX}${jti}`);
      }
    }
    await this.setRaw(session.key, session.subject, session.ttlSecs);
    await this.setRaw(session.sessionKey, JSON.stringify(sessions), session.ttlSecs);
  }

  async revokeRefreshSession(revoke: RevokeRefreshSession): Promise<void> {
    // Keep the sessions list's remaining TTL (edit value in place).
    this.store.delete(revoke.key);
    const entry = this.store.get(revoke.sessionKey);
    if (entry === undefined) return;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(revoke.sessionKey);
      return;
    }
    const sessions = MemoryCacheService.parseSessions(entry.value).filter(
      (jti) => jti !== revoke.jti,
    );
    if (sessions.length === 0) {
      this.store.delete(revoke.sessionKey);
    } else {
      this.store.set(revoke.sessionKey, {
        value: JSON.stringify(sessions),
        expiresAt: entry.expiresAt,
      });
    }
  }

  async checkOtpCode(
    key: string,
    candidate: string,
    maxAttempts: number,
  ): Promise<OtpCheckOutcome> {
    // Keep `expiresAt` on mismatch (no TTL sliding) — `KEEPTTL` equivalent.
    const entry = this.store.get(key);
    if (entry === undefined) return OtpCheckOutcome.Missing;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return OtpCheckOutcome.Missing;
    }
    let otp: OtpEntry;
    try {
      otp = JSON.parse(entry.value) as OtpEntry;
    } catch {
      this.store.delete(key);
      return OtpCheckOutcome.Missing;
    }
    // Mirror Lua's `type(entry) ~= 'table'` check: only objects count as entries.
    if (typeof otp !== "object" || otp === null || Array.isArray(otp)) {
      this.store.delete(key);
      return OtpCheckOutcome.Missing;
    }
    if (otp.code === candidate) return OtpCheckOutcome.Match;
    const attempts = (otp.attempts ?? 0) + 1;
    if (attempts >= maxAttempts) {
      this.store.delete(key);
      return OtpCheckOutcome.Locked;
    }
    this.overwriteKeepTtl(key, JSON.stringify({ code: otp.code, attempts }));
    return OtpCheckOutcome.Mismatch;
  }

  async tryAcquireLock(key: string, token: string, expirationSecs: number): Promise<boolean> {
    if (this.readLive(key) !== null) return false;
    this.store.set(key, { value: token, expiresAt: Date.now() + expirationSecs * 1000 });
    return true;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.readLive(key) !== token) return;
    this.store.delete(key);
  }
}
