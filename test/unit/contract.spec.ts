// Core↔UI contract (issue #59). Mirrored by LemonUI/src/config/contract.test.ts — change both together.
import { describe, expect, it } from "vitest";
import { OTP_LENGTH, OTP_REGEX, PASSWORD_MIN_LENGTH } from "../../src/domain/auth/constants.js";
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  USER_BIO_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USER_SEARCH_MIN_LENGTH,
} from "../../src/domain/user/constants.js";
import { STORY_MAX_CAPTION_LENGTH } from "../../src/domain/story/constants.js";
import { MESSAGE_MAX_BODY_LENGTH } from "../../src/domain/message/constants.js";
import { USER_AVATAR_MAX_BYTES } from "../../src/utils/cache/constants.js";

describe("Core↔UI contract (issue #59)", () => {
  it("OTPs are exactly 6 digits", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_REGEX).toEqual(/^\d{6}$/);
  });

  it("the OTP format accepts only an OTP_LENGTH-digit code", () => {
    expect(OTP_REGEX.test("123456")).toBe(true);
    expect(OTP_REGEX.test("12345")).toBe(false);
    expect(OTP_REGEX.test("1234567")).toBe(false);
  });

  it("passwords require at least 8 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("full names are 2-100 characters", () => {
    expect(FULL_NAME_MIN_LENGTH).toBe(2);
    expect(FULL_NAME_MAX_LENGTH).toBe(100);
  });

  it("usernames are 3-30 characters", () => {
    expect(USERNAME_MIN_LENGTH).toBe(3);
    expect(USERNAME_MAX_LENGTH).toBe(30);
  });

  it("user bios are capped at 500 characters", () => {
    expect(USER_BIO_MAX_LENGTH).toBe(500);
  });

  it("user search starts at 2 characters", () => {
    expect(USER_SEARCH_MIN_LENGTH).toBe(2);
  });

  it("user avatars are capped at 5MB", () => {
    expect(USER_AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("story captions are capped at 500 characters", () => {
    expect(STORY_MAX_CAPTION_LENGTH).toBe(500);
  });

  it("message bodies are capped at 4000 code points", () => {
    expect(MESSAGE_MAX_BODY_LENGTH).toBe(4000);
  });
});
