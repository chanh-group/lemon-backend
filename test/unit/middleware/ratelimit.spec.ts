import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  MemoryRateLimiter,
  RedisRateLimiter,
  extractClientIp,
} from "../../../src/middleware/ratelimit.js";

describe("RedisRateLimiter", () => {
  let redis: { eval: ReturnType<typeof vi.fn> };
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    redis = { eval: vi.fn() };
    logger = { warn: vi.fn(), error: vi.fn() };
    limiter = new RedisRateLimiter(redis, logger);
  });

  it("checkIpLimit uses key ratelimit:{action}:ip:{ip}", async () => {
    redis.eval.mockResolvedValue(1);
    await expect(limiter.checkIpLimit("login", "1.2.3.4", 5, 60)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "ratelimit:login:ip:1.2.3.4",
      60,
    );
  });

  it("returns true when count <= max and false when count > max", async () => {
    redis.eval.mockResolvedValueOnce(3);
    await expect(limiter.checkIpLimit("login", "ip", 3, 60)).resolves.toBe(true);
    redis.eval.mockResolvedValueOnce(4);
    await expect(limiter.checkIpLimit("login", "ip", 3, 60)).resolves.toBe(false);
  });

  it("checkEmailLimit lowercases email in key", async () => {
    redis.eval.mockResolvedValue(1);
    await limiter.checkEmailLimit("request-otp", "Foo@Bar.com", 3, 3600);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "ratelimit:request-otp:email:foo@bar.com",
      3600,
    );
  });

  it("checkMixedLimit uses user and ip keys", async () => {
    redis.eval.mockResolvedValue([1, 1]);
    await expect(
      limiter.checkMixedLimit("change-password", "user-1", "9.9.9.9", 3, 10, 60),
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "ratelimit:change-password:user:user-1",
      "ratelimit:change-password:ip:9.9.9.9",
      60,
    );
  });

  it("mixed returns false if either count exceeds its max", async () => {
    redis.eval.mockResolvedValueOnce([4, 1]);
    await expect(limiter.checkMixedLimit("a", "u", "i", 3, 10, 60)).resolves.toBe(false);
    redis.eval.mockResolvedValueOnce([1, 11]);
    await expect(limiter.checkMixedLimit("a", "u", "i", 3, 10, 60)).resolves.toBe(false);
  });

  it("fails closed when Redis is unavailable", async () => {
    redis.eval.mockRejectedValue(new Error("boom"));
    await expect(limiter.checkIpLimit("login", "ip", 5, 60)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails closed for mixed limits when Redis is unavailable", async () => {
    redis.eval.mockRejectedValue(new Error("boom"));
    await expect(limiter.checkMixedLimit("a", "u", "i", 3, 10, 60)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("MemoryRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts within window and resets after expiry", async () => {
    const limiter = new MemoryRateLimiter();
    expect(await limiter.checkIpLimit("login", "ip", 2, 60)).toBe(true);
    expect(await limiter.checkIpLimit("login", "ip", 2, 60)).toBe(true);
    expect(await limiter.checkIpLimit("login", "ip", 2, 60)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(await limiter.checkIpLimit("login", "ip", 2, 60)).toBe(true);
  });

  it("tracks email keys separately and lowercases", async () => {
    const limiter = new MemoryRateLimiter();
    expect(await limiter.checkEmailLimit("request-otp", "A@B.com", 1, 60)).toBe(true);
    expect(await limiter.checkEmailLimit("request-otp", "a@b.com", 1, 60)).toBe(false);
    expect(await limiter.checkEmailLimit("request-otp", "other@b.com", 1, 60)).toBe(true);
  });

  it("mixed tracks user and ip independently", async () => {
    const limiter = new MemoryRateLimiter();
    expect(await limiter.checkMixedLimit("cp", "u1", "ip1", 1, 1, 60)).toBe(true);
    expect(await limiter.checkMixedLimit("cp", "u1", "ip2", 1, 1, 60)).toBe(false);
    expect(await limiter.checkMixedLimit("cp", "u2", "ip1", 1, 1, 60)).toBe(false);
  });
});

describe("extractClientIp", () => {
  it("uses the Express resolved IP and ignores the raw forwarded header", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      ip: "9.9.9.9",
    } as unknown as Pick<Request, "ip">;
    expect(extractClientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to req.ip when no header", () => {
    const req = { ip: "9.9.9.9" };
    expect(extractClientIp(req)).toBe("9.9.9.9");
  });

  it("returns unknown when no address is available", () => {
    expect(extractClientIp()).toBe("unknown");
  });
});
