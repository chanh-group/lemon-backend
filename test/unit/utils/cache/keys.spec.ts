import { describe, expect, it } from "vitest";
import {
  noteFeedKey,
  purgeLockKey,
  refreshTokenKey,
  resetOtpKey,
  sessionListKey,
  signupOtpKey,
  storyFeedKey,
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

  it("builds story and note feed keys", () => {
    expect(storyFeedKey("user-123")).toBe("stories:feed:user-123");
    expect(noteFeedKey("user-123")).toBe("notes:feed:user-123");
  });

  it("builds the purge lock key", () => {
    expect(purgeLockKey()).toBe("lock:purge-stories-notes");
  });
});
