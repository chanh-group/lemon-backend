import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RedisHealthService } from "../configs/redis-health.js";
import { SystemError } from "../utils/errors/system.js";
import { SKIP_REDIS_READINESS_KEY } from "../utils/redis-readiness.js";

@Injectable()
export class RedisReadinessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RedisHealthService) private readonly redisHealth: RedisHealthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;

    const skipCheck = this.reflector.getAllAndOverride<boolean>(SKIP_REDIS_READINESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipCheck || this.redisHealth.isReady()) return true;

    throw new SystemError("unavailable", "Redis is unavailable");
  }
}
