import { Global, Module } from "@nestjs/common";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { UserModule } from "../user/module.js";
import { FriendController } from "./controller.js";
import { USER_PROFILE_CACHE_INVALIDATOR } from "../user/repository.js";
import { FRIEND_REPOSITORY } from "./repository.js";
import { FriendPgRepository } from "./pg.js";
import { ProfileFeedCacheInvalidator } from "./profile-feed-cache.service.js";
import { FriendService } from "./service.js";

@Global()
@Module({
  imports: [UserModule, RealtimeModule, RateLimitModule],
  controllers: [FriendController],
  providers: [
    {
      provide: FRIEND_REPOSITORY,
      useClass: FriendPgRepository,
    },
    FriendService,
    ProfileFeedCacheInvalidator,
    { provide: USER_PROFILE_CACHE_INVALIDATOR, useExisting: ProfileFeedCacheInvalidator },
  ],
  exports: [FriendService, USER_PROFILE_CACHE_INVALIDATOR],
})
export class FriendModule {}
