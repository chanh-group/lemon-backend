import { Logger } from "@nestjs/common";
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

  constructor(redis: unknown, logger?: unknown) {
    this.redis = redis;
    this.logger =
      (logger as
        | { warn: (message: unknown) => void; error: (message: unknown, context?: unknown) => void }
        | undefined) ?? new Logger(RedisRateLimiter.name);
  }

  private async checkRateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
    const durationSecs = Math.max(1, windowSecs);
    const redis = this.redis as { eval: (...args: unknown[]) => Promise<unknown> };
    try {
      const current = (await redis.eval(INCR_EXPIRE_SCRIPT, 1, key, durationSecs)) as number;
      return Number(current) <= max;
    } catch (err) {
      if (err instanceof SystemError) throw err;
      this.logger.error("Redis rate limiter unavailable", { err });
      throw new SystemError("unavailable", "rate limiter unavailable", { cause: err });
    }
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
    try {
      const counts = (await redis.eval(
        INCR_EXPIRE_TWO_SCRIPT,
        2,
        userKey,
        ipKey,
        durationSecs,
      )) as unknown[];
      if (Array.isArray(counts) && counts.length === 2) {
        return Number(counts[0]) <= userMax && Number(counts[1]) <= ipMax;
      }
      this.logger.error("Redis rate limiter returned an invalid result", { action });
      throw new SystemError("unavailable", "rate limiter unavailable");
    } catch (err) {
      if (err instanceof SystemError) throw err;
      this.logger.error("Redis rate limiter unavailable", { err });
      throw new SystemError("unavailable", "rate limiter unavailable", { cause: err });
    }
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
