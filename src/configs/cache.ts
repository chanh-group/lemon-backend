// Global cache wiring — mirrors `DatabaseModule`: one shared Redis client,
// token-based injection, and graceful shutdown. Redis availability is required
// before Nest can finish creating the application.
import { Global, Inject, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { get_env } from "../helpers/index.js";
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_MAX_RETRIES_PER_REQUEST,
  REDIS_RECONNECT_DELAY_BASE_MS,
  REDIS_RECONNECT_DELAY_MAX_MS,
  DEFAULT_REDIS_URL,
} from "../utils/cache/constants.js";
import { CACHE_STORE, REDIS_CLIENT } from "../utils/cache/store.js";
import { RedisHealthService } from "./redis-health.js";
import { RedisMetricsService } from "./redis-metrics.js";
import {
  RedisCacheService,
  registerCacheCommands,
  type RedisWithCacheCommands,
} from "../utils/cache/redis.js";

const logger = new Logger("Cache");

async function createRedisClient(): Promise<RedisWithCacheCommands> {
  // Dynamic import keeps the driver out of modules that do not initialize the app.
  // NOTE: named `Redis` — the package is CJS, so namespace `.default` has no
  // construct signature under nodenext; the named re-export does.
  const { Redis } = await import("ioredis");
  const redis = new Redis(get_env("REDIS_URL", DEFAULT_REDIS_URL), {
    lazyConnect: false,
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    enableReadyCheck: true,
    retryStrategy: (times: number) =>
      Math.min(times * REDIS_RECONNECT_DELAY_BASE_MS, REDIS_RECONNECT_DELAY_MAX_MS),
  }) as unknown as RedisWithCacheCommands;
  redis.on("error", (err: Error) => {
    logger.warn(`Redis connection error: ${err.message}`);
  });
  registerCacheCommands(redis);
  try {
    await redis.ping();
  } catch (err) {
    redis.disconnect();
    throw new Error("Redis is required but unavailable", { cause: err });
  }
  return redis;
}

@Global()
@Module({
  providers: [
    RedisMetricsService,
    RedisHealthService,
    {
      provide: REDIS_CLIENT,
      useFactory: async (): Promise<RedisWithCacheCommands> => {
        return createRedisClient();
      },
    },
    {
      provide: CACHE_STORE,
      useFactory: (
        redis: RedisWithCacheCommands,
        health: RedisHealthService,
        metrics: RedisMetricsService,
      ) => new RedisCacheService(redis, health, metrics),
      inject: [REDIS_CLIENT, RedisHealthService, RedisMetricsService],
    },
  ],
  exports: [CACHE_STORE, REDIS_CLIENT, RedisHealthService, RedisMetricsService],
})
export class CacheModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisWithCacheCommands) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      logger.warn(`Redis quit failed: ${String(err)}`);
    }
  }
}

export { REDIS_CLIENT } from "../utils/cache/store.js";
