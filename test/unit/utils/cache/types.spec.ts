import { describe, expect, it } from "vitest";
import { CacheError } from "../../../../src/utils/cache/error.js";
import { OtpCheckOutcome, RotationOutcome } from "../../../../src/utils/cache/types.js";

describe("cache types", () => {
  it("CacheError carries op", () => {
    const err = new CacheError("GET", new Error("boom"));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CacheError");
    expect(err.op).toBe("GET");
  });

  it("outcomes are distinct", () => {
    expect(RotationOutcome.Rotated).not.toBe(RotationOutcome.Stale);
    expect(new Set(Object.values(OtpCheckOutcome)).size).toBe(4);
  });
});
