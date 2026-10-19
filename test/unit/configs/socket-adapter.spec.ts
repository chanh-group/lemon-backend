import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { RedisIoAdapter } from "../../../src/configs/socket-adapter.js";

interface FakeRedisClient {
  on: Mock;
  quit: Mock;
  duplicate: Mock;
}

const { FakeRedis, fakeClients } = vi.hoisted(() => {
  const clients: FakeRedisClient[] = [];

  class FakeRedisClass implements FakeRedisClient {
    on = vi.fn();
    quit = vi.fn().mockResolvedValue("OK");
    duplicate = vi.fn(() => new FakeRedisClass());

    constructor() {
      clients.push(this);
    }
  }

  return { FakeRedis: FakeRedisClass, fakeClients: clients };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

describe("RedisIoAdapter", () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalMemoryCache = process.env.USE_MEMORY_CACHE;

  beforeEach(() => {
    fakeClients.length = 0;
    delete process.env.USE_MEMORY_CACHE;
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    if (originalMemoryCache === undefined) delete process.env.USE_MEMORY_CACHE;
    else process.env.USE_MEMORY_CACHE = originalMemoryCache;
  });

  it("disconnect is a no-op when Redis clients were never created", async () => {
    const adapter = new RedisIoAdapter({});

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(fakeClients).toHaveLength(0);
  });

  it("memory mode skips client creation so disconnect stays a no-op", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.USE_MEMORY_CACHE = "true";
    const adapter = new RedisIoAdapter({});

    await adapter.connectToRedis();

    expect(fakeClients).toHaveLength(0);
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it("connectToRedis retains pub/sub clients and disconnect quits them once", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const adapter = new RedisIoAdapter({});

    await adapter.connectToRedis();
    expect(fakeClients).toHaveLength(2);
    const [pubClient, subClient] = fakeClients;

    await adapter.disconnect();
    expect(pubClient.quit).toHaveBeenCalledTimes(1);
    expect(subClient.quit).toHaveBeenCalledTimes(1);

    await adapter.disconnect();
    expect(pubClient.quit).toHaveBeenCalledTimes(1);
    expect(subClient.quit).toHaveBeenCalledTimes(1);
  });

  it("disconnect still resolves when quitting a client rejects", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const adapter = new RedisIoAdapter({});

    await adapter.connectToRedis();
    fakeClients[0].quit.mockRejectedValue(new Error("connection is closed"));
    fakeClients[1].quit.mockRejectedValue(new Error("connection is closed"));

    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});
