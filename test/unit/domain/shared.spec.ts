import { BusinessError } from "../../../src/utils/errors/business.js";
import { describe, expect, it } from "vitest";
import { getAuthUser } from "../../../src/domain/shared.js";

describe("getAuthUser", () => {
  it("returns the injected id when req.user is present", () => {
    expect(getAuthUser({ user: { id: "user-1" } })).toEqual({ id: "user-1" });
  });

  it("throws UNAUTHORIZED when req.user is missing", () => {
    expect(() => getAuthUser({})).toThrow(BusinessError);
    expect(() => getAuthUser({})).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("throws UNAUTHORIZED when req.user is malformed (missing or non-string id)", () => {
    expect(() => getAuthUser({ user: {} })).toThrow(BusinessError);
    expect(() => getAuthUser({ user: { id: 42 } })).toThrow(BusinessError);
  });

  it("ignores spoofable headers entirely", () => {
    const reqWithSpoofedHeader = { headers: { "x-user-id": "spoofed" }, user: undefined };
    expect(() => getAuthUser(reqWithSpoofedHeader)).toThrow(BusinessError);
  });
});
