import { Logger } from "@nestjs/common";
import type { RedisHealthService } from "../configs/redis-health.js";
import type { RedisMetricsService } from "../configs/redis-metrics.js";
import { SystemError } from "../utils/errors/system.js";

export const RATE_LIMIT_WINDOW_SECS = 60;
export const RATE_LIMIT_EMAIL_WINDOW_SECS = 3600;
export const RATE_LIMIT_REQUEST_OTP_IP_MAX = 3;
export const RATE_LIMIT_REQUEST_OTP_EMAIL_MAX = 3;
export const RATE_LIMIT_FORGOT_PASSWORD_OTP_IP_MAX = 3;
export const RATE_LIMIT_VERIFY_OTP_IP_MAX = 10;
export const RATE_LIMIT_SIGNIN_IP_MAX = 5;
export const RATE_LIMIT_CHANGE_PASSWORD_USER_MAX = 3;
export const RATE_LIMIT_CHANGE_PASSWORD_IP_MAX = 10;
export const RATE_LIMIT_MESSAGE_USER_MAX = 60;
export const RATE_LIMIT_MESSAGE_IP_MAX = 300;
export const RATE_LIMIT_PRESIGN_USER_MAX = 10;
export const RATE_LIMIT_PRESIGN_IP_MAX = 60;
export const RATE_LIMIT_FRIEND_REQUEST_USER_MAX = 10;
export const RATE_LIMIT_FRIEND_REQUEST_IP_MAX = 60;
export const RATE_LIMIT_FRIEND_REQUEST_WINDOW_SECS = 3600;
export const RATE_LIMIT_STORY_REACT_USER_MAX = 30;
export const RATE_LIMIT_STORY_REACT_IP_MAX = 120;
export const RATE_LIMIT_STORY_REPLY_USER_MAX = 20;
export const RATE_LIMIT_STORY_REPLY_IP_MAX = 60;

export interface RateLimiter {
  checkIpLimit(action: string, ip: string, max: number, windowSecs: number): Promise<boolean>;
  checkEmailLimit(action: string, email: string, max: number, windowSecs: number): Promise<boolean>;
  checkMixedLimit(
    action: string,
    userId: string,
    ip: string,
    userMax: number,
    ipMax: number,
    windowSecs: number,
  ): Promise<boolean>;
}

export const RATE_LIMITER: unique symbol = Symbol("RATE_LIMITER");

const INCR_EXPIRE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

const INCR_EXPIRE_TWO_SCRIPT = `
local first = redis.call('INCR', KEYS[1])
if first == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local second = redis.call('INCR', KEYS[2])
if second == 1 then
    redis.call('EXPIRE', KEYS[2], ARGV[1])
end
return {first, second}
`;

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: unknown;
  private readonly logger: {
    warn: (message: unknown) => void;
    error: (message: unknown, context?: unknown) => void;
  };
  private readonly metrics?: RedisMetricsService;
  private readonly health?: RedisHealthService;

  constructor(
    redis: unknown,
    logger?: unknown,
    metrics?: RedisMetricsService,
    health?: RedisHealthService,
  ) {
    this.redis = redis;
    this.metrics = metrics;
    this.health = health;
    this.logger =
      (logger as
        | { warn: (message: unknown) => void; error: (message: unknown, context?: unknown) => void }
        | undefined) ?? new Logger(RedisRateLimiter.name);
  }

  private async measure<T>(action: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        this.health?.markUnavailable(err);
        this.logger.error("Redis rate limiter unavailable", { err });
        if (err instanceof SystemError) throw err;
        throw new SystemError("unavailable", "rate limiter unavailable", { cause: err });
      }
    };
    return this.metrics ? this.metrics.measure("rate_limit", run) : run();
  }

  private parseCounter(value: unknown): number {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^[1-9]\d*$/.test(value)
          ? Number(value)
          : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new SystemError("unavailable", "rate limiter returned an invalid counter");
    }
    return parsed;
  }

  private async checkRateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
    const durationSecs = Math.max(1, windowSecs);
    const redis = this.redis as { eval: (...args: unknown[]) => Promise<unknown> };
    return this.measure(async () => {
      const current = this.parseCounter(await redis.eval(INCR_EXPIRE_SCRIPT, 1, key, durationSecs));
      return current <= max;
    });
  }

  async checkIpLimit(
    action: string,
    ip: string,
    max: number,
    windowSecs: number,
  ): Promise<boolean> {
    return this.checkRateLimit(`ratelimit:${action}:ip:${ip}`, max, windowSecs);
  }

  async checkEmailLimit(
    action: string,
    email: string,
    max: number,
    windowSecs: number,
  ): Promise<boolean> {
    return this.checkRateLimit(`ratelimit:${action}:email:${email.toLowerCase()}`, max, windowSecs);
  }

  async checkMixedLimit(
    action: string,
    userId: string,
    ip: string,
    userMax: number,
    ipMax: number,
    windowSecs: number,
  ): Promise<boolean> {
    const userKey = `ratelimit:${action}:user:${userId}`;
    const ipKey = `ratelimit:${action}:ip:${ip}`;
    const durationSecs = Math.max(1, windowSecs);
    const redis = this.redis as { eval: (...args: unknown[]) => Promise<unknown> };
    return this.measure(async () => {
      const result = await redis.eval(INCR_EXPIRE_TWO_SCRIPT, 2, userKey, ipKey, durationSecs);
      if (Array.isArray(result) && result.length === 2) {
        const userCount = this.parseCounter(result[0]);
        const ipCount = this.parseCounter(result[1]);
        return userCount <= userMax && ipCount <= ipMax;
      }
      throw new SystemError("unavailable", "rate limiter unavailable");
    });
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  private increment(key: string, windowSecs: number): number {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      this.buckets.set(key, { count: 1, expiresAt: now + windowSecs * 1000 });
      return 1;
    }
    bucket.count += 1;
    return bucket.count;
  }

  async checkIpLimit(
    action: string,
    ip: string,
    max: number,
    windowSecs: number,
  ): Promise<boolean> {
    return this.increment(`ratelimit:${action}:ip:${ip}`, windowSecs) <= max;
  }

  async checkEmailLimit(
    action: string,
    email: string,
    max: number,
    windowSecs: number,
  ): Promise<boolean> {
    return this.increment(`ratelimit:${action}:email:${email.toLowerCase()}`, windowSecs) <= max;
  }

  async checkMixedLimit(
    action: string,
    userId: string,
    ip: string,
    userMax: number,
    ipMax: number,
    windowSecs: number,
  ): Promise<boolean> {
    const userCount = this.increment(`ratelimit:${action}:user:${userId}`, windowSecs);
    const ipCount = this.increment(`ratelimit:${action}:ip:${ip}`, windowSecs);
    return userCount <= userMax && ipCount <= ipMax;
  }
}

export function extractClientIp(req?: {
  ip?: string;
  socket?: { remoteAddress?: string | null };
}): string {
  const ip = req?.ip ?? req?.socket?.remoteAddress;
  if (typeof ip === "string" && ip.trim().length > 0) {
    return ip.trim();
  }
  return "unknown";
}
