import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { RedisHealthService } from "../../configs/redis-health.js";
import { Public } from "../../utils/decorators.js";
import { SkipRedisReadiness } from "../../utils/redis-readiness.js";

@Controller("health")
export class HealthController {
  constructor(private readonly redisHealth: RedisHealthService) {}

  @Get("ready")
  @Public()
  @SkipRedisReadiness()
  readiness(@Res() response: Response): Response {
    if (!this.redisHealth.isReady()) {
      return response.status(503).json({ success: false, ready: false });
    }
    return response.status(200).json({ success: true, ready: true });
  }
}
