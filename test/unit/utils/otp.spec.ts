import { describe, expect, it, vi } from "vitest";
import { BusinessError } from "../../../src/utils/errors/business.js";
import { CacheError } from "../../../src/utils/cache/error.js";
import { MemoryCacheService } from "../../../src/utils/cache/memory.js";
import { OTP_EXPIRATION } from "../../../src/utils/cache/constants.js";
import * as otp from "../../../src/utils/otp.js";

describe("otp store", () => {
  it("writes JSON {code, attempts:0} via setRaw with TTL 120", async () => {
    const cache = new MemoryCacheService();
    const spy = vi.spyOn(cache, "setRaw");

    await otp.store(cache, "otp:key", "123456");

    expect(spy).toHaveBeenCalledWith(
      "otp:key",
      JSON.stringify({ code: "123456", attempts: 0 }),
      OTP_EXPIRATION,
    );
    expect(OTP_EXPIRATION).toBe(120);
  });
});

describe("otp check", () => {
  it("resolves when the code matches", async () => {
    const cache = new MemoryCacheService();
    await cache.setRaw("otp:key", JSON.stringify({ code: "123456", attempts: 0 }), 120);

    await expect(otp.check(cache, "otp:key", "123456")).resolves.toBeUndefined();
  });

  it("throws BusinessError INVALID_OTP when the code is wrong", async () => {
    const cache = new MemoryCacheService();
    await cache.setRaw("otp:key", JSON.stringify({ code: "123456", attempts: 0 }), 120);

    let err: unknown;
    try {
      await otp.check(cache, "otp:key", "000000");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe("INVALID_OTP");
  });

  it("deletes the key and throws INVALID_OTP after 5 wrong attempts", async () => {
    const cache = new MemoryCacheService();
    await cache.setRaw("otp:key", JSON.stringify({ code: "123456", attempts: 0 }), 120);

    for (let i = 0; i < 4; i++) {
      await expect(otp.check(cache, "otp:key", "000000")).rejects.toBeInstanceOf(BusinessError);
    }
    await expect(otp.check(cache, "otp:key", "000000")).rejects.toBeInstanceOf(BusinessError);

    const raw = await cache.getRaw("otp:key");
    expect(raw).toBeNull();
  });

  it("throws BusinessError INVALID_OTP when the key is missing", async () => {
    const cache = new MemoryCacheService();

    await expect(otp.check(cache, "otp:missing", "123456")).rejects.toMatchObject({
      code: "INVALID_OTP",
    });
  });

  it("propagates CacheError without converting it", async () => {
    const cache = new MemoryCacheService();
    vi.spyOn(cache, "checkOtpCode").mockRejectedValueOnce(new CacheError("OTP check"));

    await expect(otp.check(cache, "otp:key", "123456")).rejects.toBeInstanceOf(CacheError);
  });
});

describe("otp consume", () => {
  it("deletes the key", async () => {
    const cache = new MemoryCacheService();
    await cache.setRaw("otp:key", JSON.stringify({ code: "123456", attempts: 0 }), 120);

    await otp.consume(cache, "otp:key");

    expect(await cache.getRaw("otp:key")).toBeNull();
  });
});
