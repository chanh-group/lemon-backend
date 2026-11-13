import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { CACHE_STORE } from "../../../../src/utils/cache/store.js";
import { noteFeedKey, storyFeedKey } from "../../../../src/utils/cache/keys.js";
import { ConversationPgRepository } from "../../../../src/domain/conversation/pg.js";
import { FriendModule } from "../../../../src/domain/friend/module.js";
import { FRIEND_REPOSITORY } from "../../../../src/domain/friend/repository.js";
import { UserModule } from "../../../../src/domain/user/module.js";
import { UserService } from "../../../../src/domain/user/service.js";
import { USER_REPOSITORY } from "../../../../src/domain/user/repository.js";
import { RATE_LIMITER } from "../../../../src/middleware/ratelimit.js";
import { JWT_CONFIG } from "../../../../src/domain/auth/constants.js";
import { AuthService } from "../../../../src/domain/auth/service.js";
import type { User } from "../../../../src/domain/user/schema.js";
import { AUTH_SESSION_REPOSITORY } from "../../../../src/domain/auth/repository.js";

const cacheDelete = vi.fn().mockResolvedValue(undefined);

@Global()
@Module({
  providers: [{ provide: CACHE_STORE, useValue: { invalidateFeedsBestEffort: cacheDelete } }],
  exports: [CACHE_STORE],
})
class TestCacheModule {}

describe("User and Friend module wiring", () => {
  it("injects the profile cache invalidator without initializing a circular gateway dependency", async () => {
    const userId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b";
    const user: User = {
      id: userId,
      email: "lemon@example.com",
      passwordHash: "hash",
      authVersion: 0,
      googleId: null,
      username: "lemon_user",
      fullName: "Lemon User",
      avatarUrl: "https://example.com/avatar.png",
      bio: null,
      phone: null,
      emailVerifiedAt: null,
      lastSeenAt: null,
      isActive: true,
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    cacheDelete.mockClear();
    const moduleRef = await Test.createTestingModule({
      imports: [TestCacheModule, UserModule, FriendModule],
    })
      .overrideProvider(USER_REPOSITORY)
      .useValue({ updateProfile: vi.fn().mockResolvedValue(user) })
      .overrideProvider(FRIEND_REPOSITORY)
      .useValue({ getAcceptedFriendIds: vi.fn().mockResolvedValue([]) })
      .overrideProvider(RATE_LIMITER)
      .useValue({ checkMixedLimit: vi.fn().mockResolvedValue(true) })
      .overrideProvider(AuthService)
      .useValue({})
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({})
      .overrideProvider(JWT_CONFIG)
      .useValue({})
      .overrideProvider(ConversationPgRepository)
      .useValue({})
      .compile();

    try {
      await moduleRef.get(UserService).updateProfile(userId, { avatarUrl: null });
      expect(cacheDelete).toHaveBeenCalledWith([storyFeedKey(userId), noteFeedKey(userId)]);
    } finally {
      await moduleRef.close();
    }
  });
});
