import { describe, expect, it, vi } from "vitest";
import { CacheError } from "../../../../src/utils/cache/cache.errors.js";
import { OtpCheckOutcome, RotationOutcome } from "../../../../src/utils/cache/cache.types.js";
import {
  RedisCacheService,
  type RedisWithCacheCommands,
} from "../../../../src/utils/cache/redis-cache.service.js";

function serviceWith(commands: Record<string, unknown>): {
  service: RedisCacheService;
  redis: Record<string, ReturnType<typeof vi.fn>>;
} {
  const redis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    pipeline: vi.fn(),
    ...commands,
  };
  return {
    service: new RedisCacheService(redis as unknown as RedisWithCacheCommands),
    redis: redis as Record<string, ReturnType<typeof vi.fn>>,
  };
}

const ROTATION = {
  oldKey: "a",
  newKey: "b",
  sessionKey: "s",
  subject: "u",
  oldJti: "o",
  newJti: "n",
  ttlSecs: 60,
};

describe("RedisCacheService", () => {
  it("maps rotate 1/0 to Rotated/Stale with KEYS/ARGV in order", async () => {
    const { service, redis } = serviceWith({ rotateRefresh: vi.fn().mockResolvedValue(1) });
    expect(await service.rotateRefreshToken(ROTATION)).toBe(RotationOutcome.Rotated);
    expect(redis["rotateRefresh"]).toHaveBeenCalledWith(3, "a", "b", "s", "u", "o", "n", 60);
    redis["rotateRefresh"].mockResolvedValue(0);
    expect(await service.rotateRefreshToken(ROTATION)).toBe(RotationOutcome.Stale);
  });

  it("wraps transport errors as CacheError, never as Stale", async () => {
    const { service } = serviceWith({ get: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(service.getRaw("k")).rejects.toBeInstanceOf(CacheError);
    const failed = serviceWith({ rotateRefresh: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(failed.service.rotateRefreshToken(ROTATION)).rejects.toBeInstanceOf(CacheError);
  });

  it("deleteMany pipelines DEL and skips empty", async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const { service, redis } = serviceWith({
      pipeline: vi.fn().mockReturnValue({ exec }),
    });
    await service.deleteMany(["a", "b"]);
    expect(redis["pipeline"]).toHaveBeenCalledWith([
      ["del", "a"],
      ["del", "b"],
    ]);
    await service.deleteMany([]);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("maps otp codes", async () => {
    const { service } = serviceWith({
      checkOtp: vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(-2)
        .mockResolvedValueOnce(-1),
    });
    expect(await service.checkOtpCode("k", "c", 5)).toBe(OtpCheckOutcome.Match);
    expect(await service.checkOtpCode("k", "c", 5)).toBe(OtpCheckOutcome.Mismatch);
    expect(await service.checkOtpCode("k", "c", 5)).toBe(OtpCheckOutcome.Locked);
    expect(await service.checkOtpCode("k", "c", 5)).toBe(OtpCheckOutcome.Missing);
  });
});
