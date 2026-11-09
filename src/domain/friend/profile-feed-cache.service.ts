import { Inject, Injectable, Logger } from "@nestjs/common";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { noteFeedKey, storyFeedKey } from "../../utils/cache/keys.js";
import type { UserProfileCacheInvalidator } from "../user/repository.js";
import { FRIEND_REPOSITORY, type FriendRepository } from "./repository.js";

@Injectable()
export class ProfileFeedCacheInvalidator implements UserProfileCacheInvalidator {
  private readonly logger = new Logger(ProfileFeedCacheInvalidator.name);

  constructor(
    @Inject(FRIEND_REPOSITORY) private readonly friendRepo: FriendRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStoreExt,
  ) {}

  async invalidateProfileFeeds(userId: string): Promise<void> {
    try {
      const friendIds = await this.friendRepo.getAcceptedFriendIds(userId);
      await this.cache.deleteManyBestEffort(
        [userId, ...friendIds].flatMap((id) => [storyFeedKey(id), noteFeedKey(id)]),
      );
    } catch (err) {
      this.logger.warn("Failed to invalidate social feeds after profile update", { userId, err });
    }
  }
}
