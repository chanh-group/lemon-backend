import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import { Public } from "../../utils/decorators.js";
import { SkipRedisReadiness } from "../../utils/redis-readiness.js";

@Controller()
export class MetricsController {
  constructor(private readonly metrics: RedisMetricsService) {}

  @Get("metrics")
  @Public()
  @SkipRedisReadiness()
  scrape(@Req() request: Request, @Res() response: Response): Response {
    const token = process.env.METRICS_TOKEN;
    if (!token) return response.status(404).end();

    const authorization = request.headers.authorization ?? "";
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(Array.isArray(authorization) ? authorization[0] : authorization);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return response.status(404).end();
    }

    return response
      .status(200)
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(this.metrics.toPrometheusText());
  }
}
