import { Inject, Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import {
  RATE_LIMITER,
  RATE_LIMIT_PRESIGN_IP_MAX,
  RATE_LIMIT_PRESIGN_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  assertMixedRateLimit,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { getAuthUser } from "../shared.js";

@Injectable()
export class UploadRateLimitInterceptor implements NestInterceptor {
  constructor(@Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<{
      user?: unknown;
      ip?: string;
      socket?: { remoteAddress?: string | null };
    }>();
    const { id: userId } = getAuthUser(req);
    await assertMixedRateLimit(
      this.rateLimiter,
      "upload-file",
      userId,
      extractClientIp(req),
      RATE_LIMIT_PRESIGN_USER_MAX,
      RATE_LIMIT_PRESIGN_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    return next.handle();
  }
}
