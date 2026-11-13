import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheService } from "../../../../src/utils/cache/memory.js";
import { OtpCheckOutcome, RotationOutcome } from "../../../../src/utils/cache/types.js";
import { CacheError } from "../../../../src/utils/cache/error.js";
import { feedFillKey } from "../../../../src/utils/cache/keys.js";

describe("MemoryCacheService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not publish a stale feed after invalidation and a newer fill", async () => {
    const cache = new MemoryCacheService();
    let resume!: (value: string[]) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const old = cache.loadFeedBestEffort("feed", 60, () => {
      started();
      return new Promise<string[]>((resolve) => {
        resume = resolve;
      });
    });
    await entered;
    await cache.invalidateFeeds(["feed"]);
    expect(await cache.loadFeedBestEffort("feed", 60, async () => ["new"])).toEqual(["new"]);
    resume(["old"]);
    expect(await old).toEqual(["old"]);
    expect(await cache.get("feed")).toEqual(["new"]);
  });

  it("does not let an expired lease overwrite or release its replacement", async () => {
    const cache = new MemoryCacheService();
    let resume!: (value: string[]) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const old = cache.loadFeedBestEffort("feed", 60, () => {
      started();
      return new Promise<string[]>((resolve) => {
        resume = resolve;
      });
    });
    await entered;
    vi.advanceTimersByTime(31_000);
    await cache.loadFeedBestEffort("feed", 60, async () => ["new"]);
    resume(["old"]);
    await old;
    expect(await cache.get("feed")).toEqual(["new"]);
  });

  it("releases the feed lease when the database load fails", async () => {
    const cache = new MemoryCacheService();
    const error = new Error("database down");
    await expect(
      cache.loadFeedBestEffort("feed", 60, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await cache.tryAcquireLock(feedFillKey("feed"), "next", 30)).toBe(true);
  });

  it("still loads the feed when acquiring the cache lease fails", async () => {
    const cache = new MemoryCacheService();
    vi.spyOn(cache, "tryAcquireLock").mockRejectedValueOnce(new CacheError("lock"));
    await expect(cache.loadFeedBestEffort("feed", 60, async () => ["database"])).resolves.toEqual([
      "database",
    ]);
    expect(await cache.get("feed")).toBeNull();
  });

  it("expires entries", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("k", "v", 60);
    vi.advanceTimersByTime(61_000);
    expect(await c.getRaw("k")).toBeNull();
  });

  it("rotates and flags replay as Stale", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("refreshToken:old", "sub", 100);
    await c.setRaw("sessions:sub", JSON.stringify(["old"]), 100);
    const r = await c.rotateRefreshToken({
      oldKey: "refreshToken:old",
      newKey: "refreshToken:new",
      sessionKey: "sessions:sub",
      subject: "sub",
      oldJti: "old",
      newJti: "new",
      ttlSecs: 100,
    });
    expect(r).toBe(RotationOutcome.Rotated);
    expect(
      await c.rotateRefreshToken({
        oldKey: "refreshToken:old",
        newKey: "refreshToken:x",
        sessionKey: "sessions:sub",
        subject: "sub",
        oldJti: "old",
        newJti: "x",
        ttlSecs: 100,
      }),
    ).toBe(RotationOutcome.Stale);
  });

  it("treats corrupt sessions list as empty on rotate", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("refreshToken:old", "sub", 100);
    await c.setRaw("sessions:sub", "{corrupt", 100);
    const r = await c.rotateRefreshToken({
      oldKey: "refreshToken:old",
      newKey: "refreshToken:new",
      sessionKey: "sessions:sub",
      subject: "sub",
      oldJti: "old",
      newJti: "new",
      ttlSecs: 100,
    });
    expect(r).toBe(RotationOutcome.Rotated);
    expect(await c.get("sessions:sub")).toEqual(["new"]);
  });

  it("treats corrupt sessions list as empty on create", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("sessions:u", "{corrupt", 100);
    await c.createRefreshSession({
      key: "refreshToken:j1",
      sessionKey: "sessions:u",
      subject: "u",
      jti: "j1",
      ttlSecs: 100,
      maxSessions: 5,
    });
    expect(await c.get("sessions:u")).toEqual(["j1"]);
  });

  it("evicts oldest beyond maxSessions", async () => {
    const c = new MemoryCacheService();
    for (let i = 1; i <= 6; i++)
      await c.createRefreshSession({
        key: `refreshToken:j${i}`,
        sessionKey: "sessions:u",
        subject: "u",
        jti: `j${i}`,
        ttlSecs: 100,
        maxSessions: 5,
      });
    expect(await c.getRaw("refreshToken:j1")).toBeNull();
    expect(await c.getRaw("refreshToken:j6")).toBe("u");
  });

  it("revokes one session and keeps the remaining sessions TTL", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("refreshToken:j1", "u", 100);
    await c.setRaw("refreshToken:j2", "u", 100);
    await c.setRaw("sessions:u", JSON.stringify(["j1", "j2"]), 100);
    vi.advanceTimersByTime(10_000);
    await c.revokeRefreshSession({
      key: "refreshToken:j1",
      sessionKey: "sessions:u",
      jti: "j1",
      ttlSecs: 100,
    });
    expect(await c.getRaw("refreshToken:j1")).toBeNull();
    expect(await c.get("sessions:u")).toEqual(["j2"]);
    // Original TTL kept (not extended): 95s later the list is gone.
    vi.advanceTimersByTime(95_000);
    expect(await c.getRaw("sessions:u")).toBeNull();
  });

  it("revoking the last session deletes the sessions key", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("refreshToken:j1", "u", 100);
    await c.setRaw("sessions:u", JSON.stringify(["j1"]), 100);
    await c.revokeRefreshSession({
      key: "refreshToken:j1",
      sessionKey: "sessions:u",
      jti: "j1",
      ttlSecs: 100,
    });
    expect(await c.getRaw("sessions:u")).toBeNull();
  });

  it("revokes the rotated token when rotation happens before family revocation", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("refreshToken:old", "u", 100);
    await c.setRaw("sessions:u", JSON.stringify(["old"]), 100);
    const rotation = c.rotateRefreshToken({
      oldKey: "refreshToken:old",
      newKey: "refreshToken:new",
      sessionKey: "sessions:u",
      subject: "u",
      oldJti: "old",
      newJti: "new",
      ttlSecs: 100,
    });
    await Promise.all([rotation, c.revokeRefreshFamily("sessions:u", ["user:u"])]);
    expect(await c.getRaw("refreshToken:old")).toBeNull();
    expect(await c.getRaw("refreshToken:new")).toBeNull();
    expect(await c.getRaw("sessions:u")).toBeNull();
  });

  it("otp mismatch keeps TTL, locked after max", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:a@x.com", JSON.stringify({ code: "123456", attempts: 0 }), 120);
    expect(await c.checkOtpCode("otp:a@x.com", "000000", 2)).toBe(OtpCheckOutcome.Mismatch);
    expect(await c.checkOtpCode("otp:a@x.com", "000000", 2)).toBe(OtpCheckOutcome.Locked);
    expect(await c.checkOtpCode("otp:a@x.com", "123456", 2)).toBe(OtpCheckOutcome.Missing);
  });

  it("allows only one concurrent consuming OTP check", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:reset", JSON.stringify({ code: "123456", attempts: 0 }), 120);
    const results = await Promise.all([
      c.checkOtpCode("otp:reset", "123456", 5, true),
      c.checkOtpCode("otp:reset", "123456", 5, true),
    ]);
    expect(results).toEqual([OtpCheckOutcome.Match, OtpCheckOutcome.Missing]);
  });

  it("corrupt otp entry is Missing and deleted", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:b@x.com", "{corrupt", 120);
    expect(await c.checkOtpCode("otp:b@x.com", "1", 5)).toBe(OtpCheckOutcome.Missing);
    expect(await c.getRaw("otp:b@x.com")).toBeNull();
  });

  it("non-object otp JSON is Missing and deleted (matches Lua type check)", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:null@x.com", "null", 120);
    await c.setRaw("otp:num@x.com", "5", 120);
    await c.setRaw("otp:str@x.com", '"abc"', 120);
    expect(await c.checkOtpCode("otp:null@x.com", "1", 5)).toBe(OtpCheckOutcome.Missing);
    expect(await c.checkOtpCode("otp:num@x.com", "1", 5)).toBe(OtpCheckOutcome.Missing);
    expect(await c.checkOtpCode("otp:str@x.com", "1", 5)).toBe(OtpCheckOutcome.Missing);
    expect(await c.getRaw("otp:null@x.com")).toBeNull();
    expect(await c.getRaw("otp:num@x.com")).toBeNull();
    expect(await c.getRaw("otp:str@x.com")).toBeNull();
  });

  it("tryAcquireLock grants the lock to the first caller only", async () => {
    const c = new MemoryCacheService();
    expect(await c.tryAcquireLock("lock:k", "t1", 60)).toBe(true);
    expect(await c.tryAcquireLock("lock:k", "t2", 60)).toBe(false);
  });

  it("tryAcquireLock grants again after the TTL expires", async () => {
    const c = new MemoryCacheService();
    await c.tryAcquireLock("lock:k", "t1", 60);
    vi.advanceTimersByTime(61_000);
    expect(await c.tryAcquireLock("lock:k", "t2", 60)).toBe(true);
  });

  it("releaseLock with the owning token frees the lock", async () => {
    const c = new MemoryCacheService();
    await c.tryAcquireLock("lock:k", "t1", 60);
    await c.releaseLock("lock:k", "t1");
    expect(await c.tryAcquireLock("lock:k", "t2", 60)).toBe(true);
  });

  it("releaseLock with a stale token keeps the current owner's lock", async () => {
    const c = new MemoryCacheService();
    await c.tryAcquireLock("lock:k", "t1", 60);
    await c.releaseLock("lock:k", "stale");
    expect(await c.tryAcquireLock("lock:k", "t2", 60)).toBe(false);
  });

  it("releaseLock after expiry is a no-op", async () => {
    const c = new MemoryCacheService();
    await c.tryAcquireLock("lock:k", "t1", 60);
    vi.advanceTimersByTime(61_000);
    await expect(c.releaseLock("lock:k", "t1")).resolves.toBeUndefined();
  });
});
