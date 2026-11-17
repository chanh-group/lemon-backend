import { describe, expect, it, vi } from "vitest";
import { CacheStoreExt } from "../../../../src/utils/cache/store.js";
import { CacheError } from "../../../../src/utils/cache/error.js";

type LockMode = "grant" | "deny" | "throw";

class Fake extends CacheStoreExt {
  store = new Map<string, string>();
  fail = false;
  lock: LockMode = "throw";
  publishFail = false;
  reads = 0;
  published: Array<{ key: string; value: string; expirationSecs: number }> = [];
  released: string[] = [];
  onGetRaw: ((key: string) => void) | null = null;

  async publishFeed(
    key: string,
    _leaseKey: string,
    _token: string,
    value: string,
    expirationSecs: number,
  ): Promise<void> {
    if (this.publishFail) throw new CacheError("PUBLISH");
    this.published.push({ key, value, expirationSecs });
  }

  async invalidateFeeds(): Promise<never> {
    throw new CacheError("INVALIDATE");
  }

  async getRaw(k: string): Promise<string | null> {
    if (this.fail) throw new CacheError("GET");
    this.reads++;
    this.onGetRaw?.(k);
    return this.store.get(k) ?? null;
  }

  async setRaw(k: string, v: string): Promise<void> {
    if (this.fail) throw new CacheError("SET");
    this.store.set(k, v);
  }

  async delete(k: string): Promise<void> {
    if (this.fail) throw new CacheError("DEL");
    this.store.delete(k);
  }

  async deleteMany(ks: string[]): Promise<void> {
    for (const k of ks) await this.delete(k);
  }

  async rotateRefreshToken(): Promise<never> {
    throw new CacheError("ROTATE");
  }

  async createRefreshSession(): Promise<never> {
    throw new CacheError("CREATE");
  }

  async revokeRefreshSession(): Promise<never> {
    throw new CacheError("REVOKE");
  }

  async revokeRefreshFamily(): Promise<never> {
    throw new CacheError("REVOKE");
  }

  async checkOtpCode(): Promise<never> {
    throw new CacheError("OTP");
  }

  async tryAcquireLock(): Promise<boolean> {
    if (this.lock === "throw") throw new CacheError("LOCK");
    return this.lock === "grant";
  }

  async releaseLock(_k: string, token: string): Promise<void> {
    if (this.lock === "throw") throw new CacheError("UNLOCK");
    this.released.push(token);
  }
}

/** Flush pending promise continuations across one real macrotask boundary. */
function flushContinuations(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("CacheStoreExt", () => {
  it("round-trips JSON", async () => {
    const c = new Fake();
    await c.set("k", { a: 1 }, 60);
    expect(await c.get<{ a: number }>("k")).toEqual({ a: 1 });
  });

  it("treats corrupt entry as miss and deletes it", async () => {
    const c = new Fake();
    c.store.set("bad", "{nope");
    expect(await c.get("bad")).toBeNull();
    expect(c.store.has("bad")).toBe(false);
  });

  it("skips circular values with a warn instead of throwing", async () => {
    const c = new Fake();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(c.set("circ", circular, 60)).resolves.toBeUndefined();
    expect(c.store.has("circ")).toBe(false);
  });

  it("bestEffort swallows infra errors", async () => {
    const c = new Fake();
    c.fail = true;
    await expect(c.getBestEffort("k")).resolves.toBeNull();
    await expect(c.setBestEffort("k", 1, 60)).resolves.toBeUndefined();
  });
});

describe("CacheStoreExt.loadFeedBestEffort", () => {
  it("coalesces concurrent cold misses into a single load", async () => {
    const c = new Fake();
    c.lock = "deny";
    let finish!: (value: string[]) => void;
    const load = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );

    const first = c.loadFeedBestEffort("feed", 60, load);
    const second = c.loadFeedBestEffort("feed", 60, load);

    // Both callers poll out (5 raw reads each), then join one shared load.
    await vi.waitFor(() => expect(c.reads).toBe(10));
    await flushContinuations();
    expect(load).toHaveBeenCalledTimes(1);

    finish(["fresh"]);
    await expect(first).resolves.toEqual(["fresh"]);
    await expect(second).resolves.toEqual(["fresh"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.published).toHaveLength(0);
  });

  it("returns the value filled during polling without loading again", async () => {
    const c = new Fake();
    c.lock = "deny";
    const load = vi.fn(async () => ["rebuild"]);
    c.onGetRaw = (key) => {
      if (c.reads === 2) c.store.set(key, JSON.stringify(["cached"]));
    };

    await expect(c.loadFeedBestEffort("feed", 60, load)).resolves.toEqual(["cached"]);
    expect(load).not.toHaveBeenCalled();
    expect(c.published).toHaveLength(0);
  });

  it("falls back to a local load when polling times out and never writes the cache", async () => {
    const c = new Fake();
    c.lock = "deny";
    const load = vi.fn(async () => ["rebuild"]);

    await expect(c.loadFeedBestEffort("feed", 60, load)).resolves.toEqual(["rebuild"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.published).toHaveLength(0);
  });

  it("publishes the loaded value and releases the lease when it owns the fill", async () => {
    const c = new Fake();
    c.lock = "grant";
    const load = vi.fn(async () => ({ a: 1 }));

    await expect(c.loadFeedBestEffort("feed", 60, load)).resolves.toEqual({ a: 1 });
    expect(c.published).toEqual([
      { key: "feed", value: JSON.stringify({ a: 1 }), expirationSecs: 60 },
    ]);
    expect(c.released).toHaveLength(1);
  });

  it("releases the lease even when the cache write fails", async () => {
    const c = new Fake();
    c.lock = "grant";
    c.publishFail = true;

    await expect(c.loadFeedBestEffort("feed", 60, async () => ["data"])).resolves.toEqual(["data"]);
    expect(c.released).toHaveLength(1);
    expect(c.published).toHaveLength(0);
  });

  it("revives polled cache values before returning them", async () => {
    const c = new Fake();
    c.lock = "deny";
    const load = vi.fn(async () => [{ at: new Date(0) }]);
    c.onGetRaw = (key) => {
      if (c.reads === 2) c.store.set(key, JSON.stringify([{ at: "1970-01-01T00:00:00.000Z" }]));
    };
    const revive = (raw: unknown): Array<{ at: Date }> =>
      (raw as Array<{ at: string }>).map((entry) => ({ at: new Date(entry.at) }));

    const result = await c.loadFeedBestEffort("feed", 60, load, revive);
    expect(result[0]?.at).toBeInstanceOf(Date);
    expect(result[0]?.at.getTime()).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it("shares the lease owner's in-flight load with a poll-timeout fallback", async () => {
    const c = new Fake();
    c.lock = "grant";
    let finish!: (value: string[]) => void;
    const load = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );

    const owner = c.loadFeedBestEffort("feed", 60, load);
    c.lock = "deny";
    const latecomer = c.loadFeedBestEffort("feed", 60, load);

    // The latecomer polls out (5 raw reads), then joins the owner's load.
    await vi.waitFor(() => expect(c.reads).toBe(5));
    await flushContinuations();
    expect(load).toHaveBeenCalledTimes(1);

    finish(["fresh"]);
    await expect(owner).resolves.toEqual(["fresh"]);
    await expect(latecomer).resolves.toEqual(["fresh"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.published).toHaveLength(1);
  });

  it("propagates loader failures instead of caching them", async () => {
    const c = new Fake();
    c.lock = "grant";
    const error = new Error("database down");

    await expect(
      c.loadFeedBestEffort("feed", 60, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(c.published).toHaveLength(0);
    expect(c.released).toHaveLength(1);
  });
});
