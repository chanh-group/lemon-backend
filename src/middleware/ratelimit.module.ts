import { Module } from "@nestjs/common";
import { REDIS_CLIENT } from "../configs/cache.js";
import type { RedisWithCacheCommands } from "../utils/cache/redis.js";
import { RATE_LIMITER } from "./ratelimit.js";
import { RedisRateLimiter } from "./ratelimit.js";

@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      useFactory: (redis: RedisWithCacheCommands) => new RedisRateLimiter(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
