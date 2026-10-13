import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheService } from "../../../../src/utils/cache/memory-cache.service.js";
import { OtpCheckOutcome, RotationOutcome } from "../../../../src/utils/cache/cache.types.js";

describe("MemoryCacheService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    await c.revokeRefreshSession({ key: "refreshToken:j1", sessionKey: "sessions:u", jti: "j1", ttlSecs: 100 });
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
    await c.revokeRefreshSession({ key: "refreshToken:j1", sessionKey: "sessions:u", jti: "j1", ttlSecs: 100 });
    expect(await c.getRaw("sessions:u")).toBeNull();
  });

  it("otp mismatch keeps TTL, locked after max", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:a@x.com", JSON.stringify({ code: "123456", attempts: 0 }), 120);
    expect(await c.checkOtpCode("otp:a@x.com", "000000", 2)).toBe(OtpCheckOutcome.Mismatch);
    expect(await c.checkOtpCode("otp:a@x.com", "000000", 2)).toBe(OtpCheckOutcome.Locked);
    expect(await c.checkOtpCode("otp:a@x.com", "123456", 2)).toBe(OtpCheckOutcome.Missing);
  });

  it("corrupt otp entry is Missing and deleted", async () => {
    const c = new MemoryCacheService();
    await c.setRaw("otp:b@x.com", "{corrupt", 120);
    expect(await c.checkOtpCode("otp:b@x.com", "1", 5)).toBe(OtpCheckOutcome.Missing);
    expect(await c.getRaw("otp:b@x.com")).toBeNull();
  });
});
