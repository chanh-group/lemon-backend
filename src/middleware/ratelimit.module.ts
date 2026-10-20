import { Module } from "@nestjs/common";
import { REDIS_CLIENT } from "../configs/cache.js";
import { RedisHealthService } from "../configs/redis-health.js";
import type { RedisWithCacheCommands } from "../utils/cache/redis.js";
import { RedisMetricsService } from "../configs/redis-metrics.js";
import { RATE_LIMITER } from "./ratelimit.js";
import { RedisRateLimiter } from "./ratelimit.js";

@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      useFactory: (
        redis: RedisWithCacheCommands,
        metrics: RedisMetricsService,
        health: RedisHealthService,
      ) => new RedisRateLimiter(redis, undefined, metrics, health),
      inject: [REDIS_CLIENT, RedisMetricsService, RedisHealthService],
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
