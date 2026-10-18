import { Module } from "@nestjs/common";
import { UserModule } from "../user/module.js";
import { REDIS_CLIENT } from "../../configs/cache.js";
import { JWT_CONFIG } from "./constants.js";
import { RATE_LIMITER } from "./constants.js";
import { AuthController } from "./controller.js";
import { AuthGuard } from "./guards/authguard.js";
import { JwtConfig } from "./jwt.js";
import { AuthService } from "./service.js";
import type { RedisWithCacheCommands } from "../../utils/cache/redis.js";
import { MemoryRateLimiter, RedisRateLimiter } from "../../middleware/ratelimit.js";

@Module({
  imports: [UserModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    { provide: JWT_CONFIG, useFactory: () => JwtConfig.from_env() },
    {
      provide: RATE_LIMITER,
      useFactory: (redis: RedisWithCacheCommands | null) =>
        redis === null ? new MemoryRateLimiter() : new RedisRateLimiter(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [AuthService, AuthGuard, JWT_CONFIG, RATE_LIMITER],
})
export class AuthModule {}
