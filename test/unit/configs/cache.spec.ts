import { beforeEach, describe, expect, it, vi } from "vitest";

describe("CacheModule", () => {
  beforeEach(() => {
    delete process.env.USE_MEMORY_CACHE;
    vi.resetModules();
  });

  it("memory mode provides MemoryCacheService without redis", async () => {
    process.env.USE_MEMORY_CACHE = "true";
    const { Test } = await import("@nestjs/testing");
    const { CacheModule } = await import("../../../src/configs/cache.js");
    const { CACHE_STORE } = await import("../../../src/utils/cache/store.js");
    const { MemoryCacheService } = await import("../../../src/utils/cache/memory.js");
    const mod = await Test.createTestingModule({ imports: [CacheModule] }).compile();
    expect(mod.get(CACHE_STORE)).toBeInstanceOf(MemoryCacheService);
    await mod.close();
    delete process.env.USE_MEMORY_CACHE;
  }, 15000);

  it("redis mode provides RedisCacheService and quits on destroy", async () => {
    const quit = vi.fn().mockResolvedValue("OK");
    const { Test } = await import("@nestjs/testing");
    const { CacheModule } = await import("../../../src/configs/cache.js");
    const { CACHE_STORE, REDIS_CLIENT } =
      await import("../../../src/utils/cache/store.js");
    const { RedisCacheService } = await import("../../../src/utils/cache/redis.js");
    const mod = await Test.createTestingModule({ imports: [CacheModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue({ quit })
      .compile();
    expect(mod.get(CACHE_STORE)).toBeInstanceOf(RedisCacheService);
    await mod.close();
    expect(quit).toHaveBeenCalledTimes(1);
  }, 15000);
});
