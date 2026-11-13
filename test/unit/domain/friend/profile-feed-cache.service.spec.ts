import { describe, expect, it, vi } from "vitest";
import { ProfileFeedCacheInvalidator } from "../../../../src/domain/friend/profile-feed-cache.service.js";
import { noteFeedKey, storyFeedKey } from "../../../../src/utils/cache/keys.js";

const userId = "0193a2b1-0000-7000-8000-000000000001";
const friendId = "0193a2b1-0000-7000-8000-000000000002";

describe("ProfileFeedCacheInvalidator", () => {
  it("deletes story and note feeds for the user and all accepted friends", async () => {
    const getAcceptedFriendIds = vi.fn().mockResolvedValue([friendId]);
    const deleteManyBestEffort = vi.fn().mockResolvedValue(undefined);
    const invalidator = new ProfileFeedCacheInvalidator(
      { getAcceptedFriendIds } as never,
      { invalidateFeedsBestEffort: deleteManyBestEffort } as never,
    );

    await invalidator.invalidateProfileFeeds(userId);

    expect(getAcceptedFriendIds).toHaveBeenCalledWith(userId);
    expect(deleteManyBestEffort).toHaveBeenCalledWith([
      storyFeedKey(userId),
      noteFeedKey(userId),
      storyFeedKey(friendId),
      noteFeedKey(friendId),
    ]);
  });

  it("keeps the profile update best-effort when friend lookup fails", async () => {
    const deleteManyBestEffort = vi.fn();
    const invalidator = new ProfileFeedCacheInvalidator(
      { getAcceptedFriendIds: vi.fn().mockRejectedValue(new Error("database down")) } as never,
      { invalidateFeedsBestEffort: deleteManyBestEffort } as never,
    );

    await expect(invalidator.invalidateProfileFeeds(userId)).resolves.toBeUndefined();
    expect(deleteManyBestEffort).not.toHaveBeenCalled();
  });
});
