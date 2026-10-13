import { describe, expect, it } from "vitest";
import {
  refreshTokenKey,
  resetOtpKey,
  sessionListKey,
  signupOtpKey,
} from "../../../../src/utils/cache/keys.js";

describe("cache.keys", () => {
  it("builds refresh/session keys", () => {
    expect(refreshTokenKey("jti-1")).toBe("refreshToken:jti-1");
    expect(sessionListKey("user-1")).toBe("sessions:user-1");
  });

  it("lowercases otp emails", () => {
    expect(signupOtpKey("A@X.com")).toBe("otp:a@x.com");
    expect(resetOtpKey("B@X.com")).toBe("forgot_otp:b@x.com");
  });
});
