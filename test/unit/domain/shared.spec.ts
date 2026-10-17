import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { getAuthUser } from "../../../src/domain/shared.js";

describe("getAuthUser", () => {
  it("returns the injected id when req.user is present", () => {
    expect(getAuthUser({ user: { id: "user-1" } })).toEqual({ id: "user-1" });
  });

  it("throws UnauthorizedException when req.user is missing", () => {
    expect(() => getAuthUser({})).toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException when req.user is malformed (missing or non-string id)", () => {
    expect(() => getAuthUser({ user: {} })).toThrow(UnauthorizedException);
    expect(() => getAuthUser({ user: { id: 42 } })).toThrow(UnauthorizedException);
  });

  it("ignores spoofable headers entirely", () => {
    const reqWithSpoofedHeader = { headers: { "x-user-id": "spoofed" }, user: undefined };
    expect(() => getAuthUser(reqWithSpoofedHeader)).toThrow(UnauthorizedException);
  });
});
