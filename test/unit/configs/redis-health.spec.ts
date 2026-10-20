import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RedisHealthService } from "../../../src/configs/redis-health.js";
import type { RedisWithCacheCommands } from "../../../src/utils/cache/redis.js";

describe("RedisHealthService", () => {
  it("marks the instance unready on Redis disconnect and ready after reconnection", () => {
    const redis = new EventEmitter() as EventEmitter & {
      status: string;
      ping: ReturnType<typeof vi.fn>;
    };
    redis.status = "ready";
    redis.ping = vi.fn().mockResolvedValue("PONG");
    const service = new RedisHealthService(redis as unknown as RedisWithCacheCommands);

    expect(service.isReady()).toBe(true);
    redis.emit("close");
    expect(service.isReady()).toBe(false);
    redis.emit("ready");
    expect(service.isReady()).toBe(true);
  });
});
