// Global cache wiring — mirrors `DatabaseModule`: one shared client, token-based
// injection, graceful shutdown. `USE_MEMORY_CACHE=true` swaps the Redis backend
// for `MemoryCacheService` (dev/test without a server).
import { Global, Inject, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { get_env } from "../helpers/index.js";
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_MAX_RETRIES_PER_REQUEST,
} from "../utils/cache/cache.constants.js";
import { CACHE_STORE, REDIS_CLIENT } from "../utils/cache/cache-store.interface.js";
import { MemoryCacheService } from "../utils/cache/memory-cache.service.js";
import {
  RedisCacheService,
  registerCacheCommands,
  type RedisWithCacheCommands,
} from "../utils/cache/redis-cache.service.js";

const logger = new Logger("Cache");

async function createRedisClient(): Promise<RedisWithCacheCommands> {
  // Dynamic import keeps memory-mode boot free of the driver (Node-safe either way).
  // NOTE: named `Redis` — the package is CJS, so namespace `.default` has no
  // construct signature under nodenext; the named re-export does.
  const { Redis } = await import("ioredis");
  const redis = new Redis(get_env("REDIS_URL", "redis://localhost:6379"), {
    lazyConnect: false,
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
  }) as unknown as RedisWithCacheCommands;
  redis.on("error", (err: Error) => {
    logger.warn(`Redis connection error: ${err.message}`);
  });
  registerCacheCommands(redis);
  return redis;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (): Promise<RedisWithCacheCommands | null> => {
        if (process.env.USE_MEMORY_CACHE === "true") return null;
        return createRedisClient();
      },
    },
    {
      provide: CACHE_STORE,
      useFactory: (redis: RedisWithCacheCommands | null) =>
        redis === null ? new MemoryCacheService() : new RedisCacheService(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisWithCacheCommands | null) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis === null) return;
    try {
      await this.redis.quit();
    } catch (err) {
      logger.warn(`Redis quit failed: ${String(err)}`);
    }
  }
}
