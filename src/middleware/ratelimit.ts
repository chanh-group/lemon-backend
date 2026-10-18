import { Logger } from "@nestjs/common";
import type { Request } from "express";

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
  private readonly logger: { warn: (message: unknown) => void };

  constructor(redis: unknown, logger?: unknown) {
    this.redis = redis;
    this.logger =
      (logger as { warn: (message: unknown) => void } | undefined) ??
      new Logger(RedisRateLimiter.name);
  }

  private async checkRateLimit(key: string, max: number, windowSecs: number): Promise<boolean> {
    const durationSecs = Math.max(1, windowSecs);
    const redis = this.redis as { eval: (...args: unknown[]) => Promise<unknown> };
    try {
      const current = (await redis.eval(INCR_EXPIRE_SCRIPT, 1, key, durationSecs)) as number;
      return Number(current) <= max;
    } catch (err) {
      this.logger.warn(`Redis rate limiter error: ${String(err)}`);
      return true;
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
      return true;
    } catch (err) {
      this.logger.warn(`Redis rate limiter error: ${String(err)}`);
      return true;
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

export function extractClientIp(req?: Request): string {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === "string") {
    const candidate = first.split(",")[0]?.trim();
    if (candidate && candidate.length > 0) return candidate;
  }
  const ip = req?.ip;
  if (typeof ip === "string" && ip.trim().length > 0) {
    return ip.trim();
  }
  return "127.0.0.1";
}
