// Cache key builders — single source of truth for every Redis key.
// All functions are pure and sync (no I/O): a key is data, not behaviour.
// Ported from Rust `dsa/src/utils/cache/keys.rs`.
import {
  FORGOT_OTP_KEY_PREFIX,
  GROUP_MEMBERS_KEY_PREFIX,
  GROUP_SUMMARY_KEY_PREFIX,
  OTP_KEY_PREFIX,
  REFRESH_TOKEN_KEY_PREFIX,
  SESSION_KEY_PREFIX,
  USER_CACHE_KEY_PREFIX,
} from "./cache.constants.js";

export function refreshTokenKey(jti: string): string {
  return `${REFRESH_TOKEN_KEY_PREFIX}${jti}`;
}

export function sessionListKey(subject: string): string {
  return `${SESSION_KEY_PREFIX}${subject}`;
}

export function userProfileKey(id: string): string {
  return `${USER_CACHE_KEY_PREFIX}${id}`;
}

export function groupSummaryKey(groupId: string): string {
  return `${GROUP_SUMMARY_KEY_PREFIX}${groupId}`;
}

export function groupMembersKey(groupId: string): string {
  return `${GROUP_MEMBERS_KEY_PREFIX}${groupId}`;
}

export function signupOtpKey(email: string): string {
  return `${OTP_KEY_PREFIX}${email.toLowerCase()}`;
}

export function resetOtpKey(email: string): string {
  return `${FORGOT_OTP_KEY_PREFIX}${email.toLowerCase()}`;
}
