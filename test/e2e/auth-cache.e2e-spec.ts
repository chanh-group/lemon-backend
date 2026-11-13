import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REFRESH_TOKEN_KEY_PREFIX } from "../../src/utils/cache/constants.js";
import {
  RedisCacheService,
  registerCacheCommands,
  type RedisWithCacheCommands,
} from "../../src/utils/cache/redis.js";
import { OtpCheckOutcome, RotationOutcome } from "../../src/utils/cache/types.js";

describe("auth cache scripts with Redis", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: true });
  const id = randomUUID();
  const sessionKey = `test:sessions:${id}`;
  const otpKey = `test:otp:${id}`;
  const oldJti = `${id}:old`;
  const newJti = `${id}:new`;
  const oldKey = `${REFRESH_TOKEN_KEY_PREFIX}${oldJti}`;
  const newKey = `${REFRESH_TOKEN_KEY_PREFIX}${newJti}`;
  let cache: RedisCacheService;

  beforeAll(async () => {
    await redis.connect();
    registerCacheCommands(redis);
    cache = new RedisCacheService(redis as RedisWithCacheCommands);
  });

  afterAll(async () => {
    await redis.del(sessionKey, otpKey, oldKey, newKey);
    await redis.quit();
  });

  it("consumes a correct OTP only once under concurrent requests", async () => {
    await cache.setRaw(otpKey, JSON.stringify({ code: "123456", attempts: 0 }), 60);
    const results = await Promise.all([
      cache.checkOtpCode(otpKey, "123456", 5, true),
      cache.checkOtpCode(otpKey, "123456", 5, true),
    ]);
    expect(results.filter((result) => result === OtpCheckOutcome.Match)).toHaveLength(1);
    expect(results.filter((result) => result === OtpCheckOutcome.Missing)).toHaveLength(1);
  });

  it("revokes the rotated token when rotation races family revocation", async () => {
    await cache.createRefreshSession({
      key: oldKey,
      sessionKey,
      subject: id,
      jti: oldJti,
      ttlSecs: 60,
      maxSessions: 5,
    });
    const [rotation] = await Promise.all([
      cache.rotateRefreshToken({
        oldKey,
        newKey,
        sessionKey,
        subject: id,
        oldJti,
        newJti,
        ttlSecs: 60,
      }),
      cache.revokeRefreshFamily(sessionKey, []),
    ]);
    expect([RotationOutcome.Rotated, RotationOutcome.Stale]).toContain(rotation);
    expect(await redis.mget(oldKey, newKey, sessionKey)).toEqual([null, null, null]);
  });
});
