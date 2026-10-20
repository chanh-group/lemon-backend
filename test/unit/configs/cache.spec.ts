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
      .useValue({ quit })
      .compile();
    expect(mod.get(CACHE_STORE)).toBeInstanceOf(RedisCacheService);
    await mod.close();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
