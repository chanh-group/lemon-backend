import { describe, expect, it, vi } from "vitest";
import { CacheError } from "../../../../src/utils/cache/error.js";
import { OtpCheckOutcome, RotationOutcome } from "../../../../src/utils/cache/types.js";
import {
  CHECK_OTP_COMMAND,
  CHECK_OTP_LUA,
  CREATE_SESSION_COMMAND,
  CREATE_SESSION_LUA,
  RedisCacheService,
  REVOKE_SESSION_COMMAND,
  REVOKE_SESSION_LUA,
  RELEASE_LOCK_COMMAND,
  RELEASE_LOCK_LUA,
  ROTATE_REFRESH_COMMAND,
  ROTATE_REFRESH_LUA,
  registerCacheCommands,
  type RedisWithCacheCommands,
} from "../../../../src/utils/cache/redis.js";

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

  it("registers all five Lua commands", () => {
    const defineCommand = vi.fn();
    registerCacheCommands({ defineCommand });
    expect(defineCommand).toHaveBeenCalledTimes(5);
    expect(defineCommand).toHaveBeenCalledWith(ROTATE_REFRESH_COMMAND, { lua: ROTATE_REFRESH_LUA });
    expect(defineCommand).toHaveBeenCalledWith(CREATE_SESSION_COMMAND, { lua: CREATE_SESSION_LUA });
    expect(defineCommand).toHaveBeenCalledWith(REVOKE_SESSION_COMMAND, { lua: REVOKE_SESSION_LUA });
    expect(defineCommand).toHaveBeenCalledWith(CHECK_OTP_COMMAND, { lua: CHECK_OTP_LUA });
    expect(defineCommand).toHaveBeenCalledWith(RELEASE_LOCK_COMMAND, { lua: RELEASE_LOCK_LUA });
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

  it("maps SET NX OK to true and null to false", async () => {
    const { service, redis } = serviceWith({ set: vi.fn().mockResolvedValue("OK") });
    expect(await service.tryAcquireLock("lock:k", "t", 60)).toBe(true);
    expect(redis["set"]).toHaveBeenCalledWith("lock:k", "t", "EX", 60, "NX");
    redis["set"].mockResolvedValue(null);
    expect(await service.tryAcquireLock("lock:k", "t", 60)).toBe(false);
  });

  it("releaseLock calls the Lua command with the key and token", async () => {
    const { service, redis } = serviceWith({ releaseLock: vi.fn().mockResolvedValue(1) });
    await service.releaseLock("lock:k", "t");
    expect(redis["releaseLock"]).toHaveBeenCalledWith(1, "lock:k", "t");
  });

  it("wraps lock acquire/release transport errors in CacheError", async () => {
    const acquire = serviceWith({ set: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(acquire.service.tryAcquireLock("lock:k", "t", 60)).rejects.toBeInstanceOf(
      CacheError,
    );
    const release = serviceWith({ releaseLock: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(release.service.releaseLock("lock:k", "t")).rejects.toBeInstanceOf(CacheError);
  });
});
