import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StoryService } from "../../../../src/domain/story/service.js";
import type { StoryRepository } from "../../../../src/domain/story/repository.js";
import type { NewStory, Story } from "../../../../src/domain/story/schema.js";
import type { CacheStoreExt } from "../../../../src/utils/cache/store.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";
import type { ConversationService } from "../../../../src/domain/conversation/service.js";
import type { MessageService } from "../../../../src/domain/message/service.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { CreateStoryDto } from "../../../../src/domain/story/dto/request.js";

describe("StoryService", () => {
  let service: StoryService;

  let createStoryMock: Mock;
  let findByIdMock: Mock;
  let findActiveByIdMock: Mock;
  let findActiveByUserIdsMock: Mock;
  let findUsersByIdsMock: Mock;
  let findViewersByStoryIdMock: Mock;
  let findViewedStoryIdsMock: Mock;
  let markAsViewedMock: Mock;
  let markDeletedMock: Mock;
  let getFriendUserIdsMock: Mock;
  let isAcceptedFriendMock: Mock;
  let findPurgeableMock: Mock;
  let deleteByIdsMock: Mock;
  let addReactionWithViewMock: Mock;
  let deleteReactionMock: Mock;
  let findReactionsByStoryIdMock: Mock;
  let findUserReactionsMock: Mock;
  let countReactionsMock: Mock;
  let archiveStoriesMock: Mock;
  let getUserStorySettingsMock: Mock;
  let upsertUserStorySettingsMock: Mock;
  let findStoryAudienceUserIdsMock: Mock;
  let isStoryAudienceMock: Mock;
  let muteAuthorMock: Mock;
  let unmuteAuthorMock: Mock;
  let getMutedAuthorIdsMock: Mock;
  let isAuthorMutedMock: Mock;
  let findArchivedStoriesByUserIdMock: Mock;

  let getBestEffortMock: Mock;
  let setBestEffortMock: Mock;
  let deleteBestEffortMock: Mock;
  let deleteManyBestEffortMock: Mock;

  let headObjectMock: Mock;
  let getBucketMock: Mock;
  let storageMock: StorageService;

  let getOrCreateDirectMock: Mock;
  let conversationServiceMock: ConversationService;
  let sendMessageMock: Mock;
  let messageServiceMock: MessageService;
  let emitStoryReactionMock: Mock;
  let emitStoryReactionRemovedMock: Mock;
  let realtimeServiceMock: RealtimeService;

  const mockStory: Story = {
    id: "0193a2b1-0000-7000-8000-000000000001",
    userId: "user-owner-1",
    kind: "IMAGE",
    bucket: "lemon-stories",
    objectKey: "stories/user-owner-1/photo.jpg",
    mimeType: "image/jpeg",
    width: 1080,
    height: 1920,
    durationMs: null,
    caption: "A sunny day",
    background: null,
    allowReplies: true,
    allowReactions: true,
    audienceMode: "ALL_FRIENDS",
    archivedAt: null,
    createdAt: new Date("2026-10-14T00:00:00Z"),
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    createStoryMock = vi.fn().mockImplementation((data: NewStory, _audienceIds?: string[]) =>
      Promise.resolve({
        ...mockStory,
        ...data,
        id: "story-id-new",
      }),
    );
    findByIdMock = vi.fn().mockResolvedValue(mockStory);
    findActiveByIdMock = vi.fn().mockResolvedValue(mockStory);
    findActiveByUserIdsMock = vi.fn().mockResolvedValue([mockStory]);
    findUsersByIdsMock = vi.fn().mockResolvedValue(
      new Map([
        [
          "user-owner-1",
          {
            id: "user-owner-1",
            username: "owner",
            fullName: "Owner User",
            avatarUrl: null,
          },
        ],
      ]),
    );
    findViewersByStoryIdMock = vi.fn().mockResolvedValue({
      items: [
        {
          user: {
            id: "viewer-1",
            username: "friend1",
            fullName: "Friend One",
            avatarUrl: null,
          },
          viewedAt: new Date(),
        },
      ],
      nextCursor: null,
      hasMore: false,
      totalViewsCount: 1,
    });
    findViewedStoryIdsMock = vi.fn().mockResolvedValue(new Set());
    markAsViewedMock = vi.fn().mockResolvedValue(undefined);
    markDeletedMock = vi.fn().mockResolvedValue(true);
    getFriendUserIdsMock = vi.fn().mockResolvedValue(["friend-1", "friend-2"]);
    isAcceptedFriendMock = vi.fn().mockResolvedValue(true);
    findPurgeableMock = vi.fn().mockResolvedValue([]);
    deleteByIdsMock = vi.fn().mockResolvedValue(0);
    archiveStoriesMock = vi.fn().mockResolvedValue(1);
    addReactionWithViewMock = vi.fn().mockResolvedValue({
      reaction: {
        storyId: "story-1",
        userId: "user-1",
        emoji: "❤️",
        kind: "REACTION",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isNew: true,
    });
    deleteReactionMock = vi.fn().mockResolvedValue(true);
    findReactionsByStoryIdMock = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    findUserReactionsMock = vi.fn().mockResolvedValue(new Map());
    countReactionsMock = vi.fn().mockResolvedValue(new Map());

    getUserStorySettingsMock = vi.fn().mockResolvedValue({
      userId: "user-1",
      viewedReceiptsEnabled: true,
      archiveEnabled: true,
      archiveDurationSecs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    upsertUserStorySettingsMock = vi.fn().mockImplementation((userId, data) =>
      Promise.resolve({
        userId,
        viewedReceiptsEnabled: true,
        archiveEnabled: true,
        archiveDurationSecs: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    );
    findStoryAudienceUserIdsMock = vi.fn().mockResolvedValue([]);
    isStoryAudienceMock = vi.fn().mockResolvedValue(true);
    muteAuthorMock = vi.fn().mockResolvedValue(undefined);
    unmuteAuthorMock = vi.fn().mockResolvedValue(true);
    getMutedAuthorIdsMock = vi.fn().mockResolvedValue([]);
    isAuthorMutedMock = vi.fn().mockResolvedValue(false);
    findArchivedStoriesByUserIdMock = vi.fn().mockResolvedValue({ items: [], hasMore: false });

    getBestEffortMock = vi.fn().mockResolvedValue(null);
    setBestEffortMock = vi.fn().mockResolvedValue(undefined);
    deleteBestEffortMock = vi.fn().mockResolvedValue(undefined);
    deleteManyBestEffortMock = vi.fn().mockResolvedValue(undefined);

    headObjectMock = vi.fn().mockResolvedValue({ contentLength: 1000, contentType: "image/jpeg" });
    getBucketMock = vi.fn().mockReturnValue("lemon-stories");
    storageMock = {
      presignPut: vi.fn(),
      headObject: headObjectMock,
      deleteObjects: vi.fn(),
      getBucket: getBucketMock,
    };

    const mockRepo: StoryRepository = {
      create: createStoryMock,
      findById: findByIdMock,
      findActiveById: findActiveByIdMock,
      findActiveByUserIds: findActiveByUserIdsMock,
      findUsersByIds: findUsersByIdsMock,
      findViewersByStoryId: findViewersByStoryIdMock,
      findViewedStoryIds: findViewedStoryIdsMock,
      markAsViewed: markAsViewedMock,
      markDeleted: markDeletedMock,
      getFriendUserIds: getFriendUserIdsMock,
      isAcceptedFriend: isAcceptedFriendMock,
      findPurgeable: findPurgeableMock,
      deleteByIds: deleteByIdsMock,
      archiveStories: archiveStoriesMock,
      addReactionWithView: addReactionWithViewMock,
      deleteReaction: deleteReactionMock,
      findReactionsByStoryId: findReactionsByStoryIdMock,
      findUserReactions: findUserReactionsMock,
      countReactions: countReactionsMock,
      getUserStorySettings: getUserStorySettingsMock,
      upsertUserStorySettings: upsertUserStorySettingsMock,
      findStoryAudienceUserIds: findStoryAudienceUserIdsMock,
      isStoryAudience: isStoryAudienceMock,
      muteAuthor: muteAuthorMock,
      unmuteAuthor: unmuteAuthorMock,
      getMutedAuthorIds: getMutedAuthorIdsMock,
      isAuthorMuted: isAuthorMutedMock,
      findArchivedStoriesByUserId: findArchivedStoriesByUserIdMock,
    };

    const mockCache = {
      getBestEffort: getBestEffortMock,
      setBestEffort: setBestEffortMock,
      deleteBestEffort: deleteBestEffortMock,
      deleteManyBestEffort: deleteManyBestEffortMock,
    } as unknown as CacheStoreExt;

    getOrCreateDirectMock = vi.fn().mockResolvedValue({ id: "conv-1" });
    conversationServiceMock = {
      getOrCreateDirect: getOrCreateDirectMock,
    } as unknown as ConversationService;

    sendMessageMock = vi.fn().mockResolvedValue({ id: "msg-1" });
    messageServiceMock = {
      sendMessage: sendMessageMock,
    } as unknown as MessageService;

    emitStoryReactionMock = vi.fn();
    emitStoryReactionRemovedMock = vi.fn();
    realtimeServiceMock = {
      emitStoryReaction: emitStoryReactionMock,
      emitStoryReactionRemoved: emitStoryReactionRemovedMock,
    } as unknown as RealtimeService;

    service = new StoryService(
      mockRepo,
      mockCache,
      storageMock,
      conversationServiceMock,
      messageServiceMock,
      realtimeServiceMock,
    );
  });

  describe("createStory", () => {
    it("creates an image story and invalidates cache for friends", async () => {
      const dto: CreateStoryDto = {
        kind: "IMAGE",
        objectKey: "stories/user-owner-1/photo.jpg",
        caption: "A sunny day",
      };

      const result = await service.createStory("user-owner-1", dto);

      expect(headObjectMock).toHaveBeenCalledWith("stories/user-owner-1/photo.jpg");
      expect(createStoryMock).toHaveBeenCalled();
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "stories:feed:user-owner-1",
        "stories:feed:friend-1",
        "stories:feed:friend-2",
      ]);
      expect(result.id).toBe("story-id-new");
    });

    it("creates a custom audience story and invalidates cache only for that audience", async () => {
      const dto: CreateStoryDto = {
        kind: "TEXT",
        caption: "Close friends only",
        background: "#000",
        audienceMode: "CUSTOM",
        audienceUserIds: ["friend-1"],
      };

      await service.createStory("user-owner-1", dto);

      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ audienceMode: "CUSTOM" }),
        ["friend-1"],
      );
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "stories:feed:user-owner-1",
        "stories:feed:friend-1",
      ]);
    });
  });

  describe("reactStory and likeStory", () => {
    it("throws STORY_INTERACTIONS_DISABLED when reactions are turned off for reactStory", async () => {
      findActiveByIdMock.mockResolvedValueOnce({
        ...mockStory,
        allowReactions: false,
      });

      await expect(service.reactStory("friend-1", mockStory.id, "❤️")).rejects.toMatchObject({
        code: "STORY_INTERACTIONS_DISABLED",
      });
    });

    it("throws STORY_INTERACTIONS_DISABLED when reactions are turned off for likeStory", async () => {
      findActiveByIdMock.mockResolvedValueOnce({
        ...mockStory,
        allowReactions: false,
      });

      await expect(service.likeStory("friend-1", mockStory.id)).rejects.toMatchObject({
        code: "STORY_INTERACTIONS_DISABLED",
      });
    });

    it("adds silent like without sending direct message", async () => {
      const now = new Date();
      addReactionWithViewMock.mockResolvedValueOnce({
        reaction: {
          storyId: mockStory.id,
          userId: "friend-1",
          emoji: "❤️",
          kind: "LIKE",
          createdAt: now,
          updatedAt: now,
        },
        isNew: true,
      });

      const result = await service.likeStory("friend-1", mockStory.id);

      expect(addReactionWithViewMock).toHaveBeenCalledWith(
        mockStory.id,
        "friend-1",
        "❤️",
        "LIKE",
        false,
      );
      expect(sendMessageMock).not.toHaveBeenCalled();
      expect(result.kind).toBe("LIKE");
    });
  });

  describe("viewStory and privacy receipts", () => {
    it("marks as anonymous view when user has disabled viewed receipts", async () => {
      getUserStorySettingsMock.mockResolvedValueOnce({
        userId: "friend-1",
        viewedReceiptsEnabled: false,
        archiveEnabled: true,
        archiveDurationSecs: null,
      });

      await service.viewStory("friend-1", mockStory.id);

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1", true);
    });

    it("marks as non-anonymous view when user has viewed receipts enabled", async () => {
      getUserStorySettingsMock.mockResolvedValueOnce({
        userId: "friend-1",
        viewedReceiptsEnabled: true,
        archiveEnabled: true,
        archiveDurationSecs: null,
      });

      await service.viewStory("friend-1", mockStory.id);

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1", false);
    });
  });

  describe("replyStory", () => {
    it("throws STORY_INTERACTIONS_DISABLED when replies are turned off", async () => {
      findActiveByIdMock.mockResolvedValueOnce({
        ...mockStory,
        allowReplies: false,
      });

      await expect(
        service.replyStory("friend-1", mockStory.id, { body: "Hello" }),
      ).rejects.toMatchObject({
        code: "STORY_INTERACTIONS_DISABLED",
      });
    });

    it("sends reply and marks story as viewed", async () => {
      const result = await service.replyStory("friend-1", mockStory.id, { body: "Hello" });

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1", false);
      expect(sendMessageMock).toHaveBeenCalled();
      expect(result.id).toBe("msg-1");
    });
  });

  describe("mutes", () => {
    it("mutes an author and invalidates viewer feed cache", async () => {
      await service.muteAuthor("user-1", "user-2");
      expect(muteAuthorMock).toHaveBeenCalledWith("user-1", "user-2");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:user-1");
    });

    it("throws CANNOT_MUTE_SELF when trying to mute self", async () => {
      await expect(service.muteAuthor("user-1", "user-1")).rejects.toMatchObject({
        code: "CANNOT_MUTE_SELF",
      });
    });
  });

  describe("settings", () => {
    it("retrieves and updates user story settings", async () => {
      const settings = await service.getStorySettings("user-1");
      expect(settings.viewedReceiptsEnabled).toBe(true);

      const updated = await service.updateStorySettings("user-1", {
        viewedReceiptsEnabled: false,
      });
      expect(upsertUserStorySettingsMock).toHaveBeenCalledWith("user-1", {
        viewedReceiptsEnabled: false,
      });
      expect(updated.viewedReceiptsEnabled).toBe(false);
    });
  });
});
