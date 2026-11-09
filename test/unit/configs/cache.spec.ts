import { beforeEach, describe, expect, it, vi } from "vitest";

describe("CacheModule", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("provides RedisCacheService and quits Redis on destroy", async () => {
    const { Test } = await import("@nestjs/testing");
    const { CacheModule } = await import("../../../src/configs/cache.js");
    const { CACHE_STORE, REDIS_CLIENT } = await import("../../../src/utils/cache/store.js");
    const { RedisCacheService } = await import("../../../src/utils/cache/redis.js");
    const quit = vi.fn().mockResolvedValue("OK");
    const mod = await Test.createTestingModule({ imports: [CacheModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue({ quit, status: "ready", on: vi.fn(), ping: vi.fn().mockResolvedValue("PONG") })
      .compile();
    expect(mod.get(CACHE_STORE)).toBeInstanceOf(RedisCacheService);
    await mod.close();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("uses REDIS_CONNECTION_TIMEOUT for Redis connection and command timeouts", async () => {
    const originalTimeout = process.env.REDIS_CONNECTION_TIMEOUT;
    process.env.REDIS_CONNECTION_TIMEOUT = "5000";
    const redis = {
      defineCommand: vi.fn(),
      on: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    const Redis = vi.fn(function () {
      return redis;
    });
    vi.doMock("ioredis", () => ({ Redis }));

    try {
      const { Test } = await import("@nestjs/testing");
      const { CacheModule } = await import("../../../src/configs/cache.js");
      const mod = await Test.createTestingModule({ imports: [CacheModule] }).compile();
      expect(Redis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ connectTimeout: 5000, commandTimeout: 5000 }),
      );
      await mod.close();
    } finally {
      vi.doUnmock("ioredis");
      if (originalTimeout === undefined) delete process.env.REDIS_CONNECTION_TIMEOUT;
      else process.env.REDIS_CONNECTION_TIMEOUT = originalTimeout;
    }
  });
});
