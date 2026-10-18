import { MAX_OTP_ATTEMPTS, OTP_EXPIRATION } from "./cache/constants.js";
import { signupOtpKey, resetOtpKey } from "./cache/keys.js";
import type { CacheStore } from "./cache/store.js";
import { OtpCheckOutcome } from "./cache/types.js";
import type { OtpEntry } from "./cache/types.js";
import { BusinessError } from "./errors/business.js";

export type { OtpEntry };

export function signupKey(email: string): string {
  return signupOtpKey(email);
}

export function resetKey(email: string): string {
  return resetOtpKey(email);
}

export async function store(cache: CacheStore, key: string, code: string): Promise<void> {
  await cache.setRaw(key, JSON.stringify({ code, attempts: 0 }), OTP_EXPIRATION);
}

export async function check(cache: CacheStore, key: string, otp: string): Promise<void> {
  const outcome = await cache.checkOtpCode(key, otp, MAX_OTP_ATTEMPTS);
  if (outcome !== OtpCheckOutcome.Match) {
    throw new BusinessError("INVALID_OTP");
  }
}

export async function consume(cache: CacheStore, key: string): Promise<void> {
  await cache.delete(key);
}

export default { store, check, consume, signupKey, resetKey };
