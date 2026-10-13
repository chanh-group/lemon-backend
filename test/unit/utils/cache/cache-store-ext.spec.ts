import { describe, expect, it } from "vitest";
import { CacheStoreExt } from "../../../../src/utils/cache/cache-store.interface.js";
import { CacheError } from "../../../../src/utils/cache/cache.errors.js";

class Fake extends CacheStoreExt {
  store = new Map<string, string>();
  fail = false;

  async getRaw(k: string): Promise<string | null> {
    if (this.fail) throw new CacheError("GET");
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

  async checkOtpCode(): Promise<never> {
    throw new CacheError("OTP");
  }
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
