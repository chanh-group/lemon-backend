import { describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { CacheModule } from "../../../src/configs/cache.js";
import { RedisRateLimiter, RATE_LIMITER } from "../../../src/middleware/ratelimit.js";
import { RateLimitModule } from "../../../src/middleware/ratelimit.module.js";
import { REDIS_CLIENT } from "../../../src/utils/cache/store.js";

describe("RateLimitModule", () => {
  it("provides the Redis-backed limiter through the required token", async () => {
    const redis = {
      status: "ready",
      on: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
      quit: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule, RateLimitModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .compile();

    expect(moduleRef.get(RATE_LIMITER)).toBeInstanceOf(RedisRateLimiter);
    await moduleRef.close();
    expect(redis.quit).toHaveBeenCalledOnce();
  });
});
