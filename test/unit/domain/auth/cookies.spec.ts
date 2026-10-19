import { describe, expect, it } from "vitest";
import {
  clearRefreshCookieOptions,
  refreshCookieOptions,
  resolveCookieConfig,
} from "../../../../src/domain/auth/cookies.js";

// Mirrors `get_env`: missing/empty value falls back to the provided default.
function env(values: Record<string, string>): (key: string, def?: string) => string {
  return (key, def) => values[key] ?? def ?? "";
}

describe("resolveCookieConfig", () => {
  it("defaults to secure=false and sameSite=strict when COOKIE_* are unset", () => {
    expect(resolveCookieConfig(env({}))).toEqual({ secure: false, sameSite: "strict" });
  });

  it("throws when COOKIE_SAMESITE=none without COOKIE_SECURE=true", () => {
    expect(() =>
      resolveCookieConfig(env({ COOKIE_SAMESITE: "none", COOKIE_SECURE: "false" })),
    ).toThrowError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
  });

  it("accepts COOKIE_SAMESITE=none when COOKIE_SECURE=true", () => {
    expect(resolveCookieConfig(env({ COOKIE_SAMESITE: "none", COOKIE_SECURE: "true" }))).toEqual({
      secure: true,
      sameSite: "none",
    });
  });

  it("trims and lowercases COOKIE_SAMESITE", () => {
    expect(resolveCookieConfig(env({ COOKIE_SAMESITE: "LAX " }))).toEqual({
      secure: false,
      sameSite: "lax",
    });
  });

  it("falls back to strict for unknown COOKIE_SAMESITE values", () => {
    expect(resolveCookieConfig(env({ COOKIE_SAMESITE: "bogus" })).sameSite).toBe("strict");
  });

  it("reads COOKIE_SECURE case-insensitively and accepts 1", () => {
    expect(resolveCookieConfig(env({ COOKIE_SECURE: "TRUE" })).secure).toBe(true);
    expect(resolveCookieConfig(env({ COOKIE_SECURE: "1" })).secure).toBe(true);
  });

  it("falls back to secure=false for unknown COOKIE_SECURE values", () => {
    expect(resolveCookieConfig(env({ COOKIE_SECURE: "yes" })).secure).toBe(false);
  });
});

describe("refreshCookieOptions", () => {
  it("builds an httpOnly cookie scoped to /auth with a 7-day maxAge", () => {
    expect(refreshCookieOptions({ secure: true, sameSite: "lax" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800000,
    });
  });
});

describe("clearRefreshCookieOptions", () => {
  it("expires the cookie immediately", () => {
    expect(clearRefreshCookieOptions({ secure: true, sameSite: "none" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 0,
    });
  });

  it("keeps the same httpOnly/secure/sameSite/path as the set builder", () => {
    const cfg = { secure: true, sameSite: "lax" } as const;
    const setOpts = refreshCookieOptions(cfg);
    const clearOpts = clearRefreshCookieOptions(cfg);

    expect(clearOpts).toMatchObject({
      httpOnly: setOpts.httpOnly,
      secure: setOpts.secure,
      sameSite: setOpts.sameSite,
      path: setOpts.path,
    });
    expect(setOpts.maxAge).toBe(604800000);
    expect(clearOpts.maxAge).toBe(0);
  });
});
