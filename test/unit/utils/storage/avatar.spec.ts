import { afterEach, describe, expect, it, vi } from "vitest";
import {
  avatarObjectKeyFromUrl,
  avatarUrlForObjectKey,
  isAvatarFileName,
} from "../../../../src/utils/storage/avatar.js";

const userId = "0193a2b1-0000-7000-8000-000000000001";
const fileName = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png";

describe("avatar URL helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a stable API URL to its user-scoped object key", () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const url = avatarUrlForObjectKey(userId, `avatars/${userId}/${fileName}`);

    expect(url).toBe(`https://api.example.com/api/files/avatars/${userId}/${fileName}`);
    expect(avatarObjectKeyFromUrl(url, userId)).toBe(`avatars/${userId}/${fileName}`);
  });

  it("rejects non-avatar filenames and URLs outside the configured user path", () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");

    expect(isAvatarFileName("../../secret.png")).toBe(false);
    expect(
      avatarObjectKeyFromUrl(
        `https://evil.example/api/files/avatars/${userId}/${fileName}`,
        userId,
      ),
    ).toBeNull();
    expect(
      avatarObjectKeyFromUrl(
        `https://api.example.com/api/files/avatars/${userId}/${fileName}?x=1`,
        userId,
      ),
    ).toBeNull();
    expect(
      avatarObjectKeyFromUrl(`https://api.example.com/api/files/avatars/other/${fileName}`, userId),
    ).toBeNull();
  });
});
