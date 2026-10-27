// Cookie config — ported from Rust `dsa/src/domain/users/handle.rs` (`CookieConfig`).
//
// `resolveCookieConfig()` runs once at boot (controller construction) so a
// forbidden `SameSite=none` + `Secure=false` combo fails fast instead of
// silently producing cookies browsers refuse to store.
import type { CookieOptions } from "express";
import { get_env } from "../../helpers/index.js";
import { REFRESH_COOKIE_PATH, REFRESH_TOKEN_EXPIRATION_SECS } from "./constants.js";

export interface CookieConfig {
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
}

/**
 * Parse `COOKIE_SAMESITE`: `lax`/`none` case-insensitive + trimmed, anything
 * else (including unset) falls back to `strict` — fail-closed.
 */
function parseSameSite(raw: unknown): CookieConfig["sameSite"] {
  const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  switch (value.trim().toLowerCase()) {
    case "lax":
      return "lax";
    case "none":
      return "none";
    default:
      return "strict";
  }
}

/** Parse `COOKIE_SECURE`: `true` (case-insensitive) or `1` enable it, else false. */
function parseSecure(raw: unknown): boolean {
  const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Read cookie config from env (defaults: `COOKIE_SECURE=false`,
 * `COOKIE_SAMESITE=strict`). Throws at boot when `none` is requested without
 * `secure` — browsers reject `SameSite=None` without `Secure`, so auth would
 * break silently at runtime.
 *
 * `env` is injectable so unit tests never touch `process.env`.
 */
export function resolveCookieConfig(
  env: (key: string, def?: string) => string = get_env,
): CookieConfig {
  const secure = parseSecure(env("COOKIE_SECURE", "false"));
  const sameSite = parseSameSite(env("COOKIE_SAMESITE", "strict"));

  if (sameSite === "none" && !secure) {
    throw new Error("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
  }

  return { secure, sameSite };
}

/** Build the refresh-cookie attributes used when setting the cookie. */
export function refreshCookieOptions(cfg: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_EXPIRATION_SECS * 1000,
  };
}

/** Build the matching clear attributes — same identity attrs, `maxAge: 0`. */
export function clearRefreshCookieOptions(cfg: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: cfg.sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  };
}
