import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CacheStoreExt } from "../../../../src/utils/cache/store.js";
import type { PurgeableStory, StoryRepository } from "../../../../src/domain/story/repository.js";
import { StoryService } from "../../../../src/domain/story/service.js";
import type { NewStory, Story, StoryReaction } from "../../../../src/domain/story/schema.js";
import type { CreateStoryDto } from "../../../../src/domain/story/dto/request.js";
import type {
  StoryReactionResponse,
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "../../../../src/domain/story/dto/response.js";
import { StorageError } from "../../../../src/utils/storage/error.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";
import type { ConversationService } from "../../../../src/domain/conversation/service.js";
import type { MessageService } from "../../../../src/domain/message/service.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";

describe("StoryService", () => {
  let service: StoryService;

  let createStoryMock: Mock<(data: NewStory) => Promise<Story>>;
  let findByIdMock: Mock<(id: string) => Promise<Story | null>>;
  let findActiveByIdMock: Mock<(id: string) => Promise<Story | null>>;
  let findActiveByUserIdsMock: Mock<(userIds: string[]) => Promise<Story[]>>;
  let findUsersByIdsMock: Mock<
    (
      userIds: string[],
    ) => Promise<
      Map<string, { id: string; username: string; fullName: string; avatarUrl: string | null }>
    >
  >;
  let findViewersByStoryIdMock: Mock<
    (
      storyId: string,
      cursor: string | undefined,
      limit: number,
    ) => Promise<{
      items: StoryViewerResponse[];
      nextCursor?: string;
      hasMore: boolean;
    }>
  >;
  let findViewedStoryIdsMock: Mock<(userId: string, storyIds: string[]) => Promise<Set<string>>>;
  let markAsViewedMock: Mock<(storyId: string, viewerId: string) => Promise<void>>;
  let markDeletedMock: Mock<(id: string) => Promise<boolean>>;
  let getFriendUserIdsMock: Mock<(userId: string) => Promise<string[]>>;
  let isAcceptedFriendMock: Mock<(userAId: string, userBId: string) => Promise<boolean>>;
  let findPurgeableMock: Mock<(limit: number) => Promise<PurgeableStory[]>>;
  let deleteByIdsMock: Mock<(ids: string[]) => Promise<number>>;
  let addOrUpdateReactionMock: Mock<
    (storyId: string, userId: string, emoji: string) => Promise<StoryReaction>
  >;
  let deleteReactionMock: Mock<(storyId: string, userId: string) => Promise<boolean>>;
  let findReactionsByStoryIdMock: Mock<(storyId: string) => Promise<StoryReactionResponse[]>>;
  let findUserReactionsMock: Mock<
    (userId: string, storyIds: string[]) => Promise<Map<string, string>>
  >;
  let countReactionsMock: Mock<(storyIds: string[]) => Promise<Map<string, number>>>;

  let getBestEffortMock: Mock<(key: string) => Promise<unknown>>;
  let setBestEffortMock: Mock<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>;
  let deleteBestEffortMock: Mock<(key: string) => Promise<void>>;
  let deleteManyBestEffortMock: Mock<(keys: string[]) => Promise<void>>;

  let headObjectMock: Mock<
    (objectKey: string) => Promise<{ contentLength: number; contentType: string } | null>
  >;
  let getBucketMock: Mock<() => string>;
  let storageMock: StorageService;

  let getOrCreateDirectMock: Mock;
  let conversationServiceMock: ConversationService;
  let sendMessageMock: Mock;
  let messageServiceMock: MessageService;
  let emitStoryReactionMock: Mock;
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
    createdAt: new Date("2026-10-14T00:00:00Z"),
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    createStoryMock = vi
      .fn<(data: NewStory) => Promise<Story>>()
      .mockImplementation((data: NewStory) =>
        Promise.resolve({
          ...mockStory,
          ...data,
          id: "story-id-new",
        }),
      );
    findByIdMock = vi.fn<(id: string) => Promise<Story | null>>().mockResolvedValue(mockStory);
    findActiveByIdMock = vi
      .fn<(id: string) => Promise<Story | null>>()
      .mockResolvedValue(mockStory);
    findActiveByUserIdsMock = vi
      .fn<(userIds: string[]) => Promise<Story[]>>()
      .mockResolvedValue([mockStory]);
    findUsersByIdsMock = vi
      .fn<
        (
          userIds: string[],
        ) => Promise<
          Map<string, { id: string; username: string; fullName: string; avatarUrl: string | null }>
        >
      >()
      .mockResolvedValue(
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
    findViewersByStoryIdMock = vi
      .fn<
        (
          storyId: string,
          cursor: string | undefined,
          limit: number,
        ) => Promise<{
          items: StoryViewerResponse[];
          nextCursor?: string;
          hasMore: boolean;
        }>
      >()
      .mockResolvedValue({
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
        hasMore: false,
      });
    findViewedStoryIdsMock = vi
      .fn<(userId: string, storyIds: string[]) => Promise<Set<string>>>()
      .mockResolvedValue(new Set());
    markAsViewedMock = vi
      .fn<(storyId: string, viewerId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    markDeletedMock = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
    getFriendUserIdsMock = vi
      .fn<(userId: string) => Promise<string[]>>()
      .mockResolvedValue(["friend-1", "friend-2"]);
    isAcceptedFriendMock = vi
      .fn<(userAId: string, userBId: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    findPurgeableMock = vi.fn<(limit: number) => Promise<PurgeableStory[]>>().mockResolvedValue([]);
    deleteByIdsMock = vi.fn<(ids: string[]) => Promise<number>>().mockResolvedValue(0);
    addOrUpdateReactionMock = vi
      .fn<(storyId: string, userId: string, emoji: string) => Promise<StoryReaction>>()
      .mockResolvedValue({
        storyId: "story-1",
        userId: "user-1",
        emoji: "❤️",
        createdAt: new Date(),
      });
    deleteReactionMock = vi
      .fn<(storyId: string, userId: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    findReactionsByStoryIdMock = vi
      .fn<(storyId: string) => Promise<StoryReactionResponse[]>>()
      .mockResolvedValue([]);
    findUserReactionsMock = vi
      .fn<(userId: string, storyIds: string[]) => Promise<Map<string, string>>>()
      .mockResolvedValue(new Map());
    countReactionsMock = vi
      .fn<(storyIds: string[]) => Promise<Map<string, number>>>()
      .mockResolvedValue(new Map());

    getBestEffortMock = vi.fn<(key: string) => Promise<unknown>>().mockResolvedValue(null);
    setBestEffortMock = vi
      .fn<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    deleteBestEffortMock = vi.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined);
    deleteManyBestEffortMock = vi
      .fn<(keys: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);

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
      addOrUpdateReaction: addOrUpdateReactionMock,
      deleteReaction: deleteReactionMock,
      findReactionsByStoryId: findReactionsByStoryIdMock,
      findUserReactions: findUserReactionsMock,
      countReactions: countReactionsMock,
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
    realtimeServiceMock = {
      emitStoryReaction: emitStoryReactionMock,
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
    it("creates an IMAGE story with valid objectKey", async () => {
      const result = await service.createStory("user-owner-1", {
        kind: "IMAGE",
        objectKey: "stories/user-owner-1/photo.jpg",
        caption: "Nice photo",
      });

      expect(result.id).toBe("story-id-new");
      expect(result.kind).toBe("IMAGE");
      expect(createStoryMock).toHaveBeenCalledTimes(1);
      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "lemon-stories", mimeType: "image/jpeg" }),
      );
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "stories:feed:user-owner-1",
        "stories:feed:friend-1",
        "stories:feed:friend-2",
      ]);
    });

    it("creates a TEXT story with caption and background", async () => {
      const result = await service.createStory("user-owner-1", {
        kind: "TEXT",
        caption: "Good morning!",
        background: "#3b82f6",
      });

      expect(result.kind).toBe("TEXT");
      expect(result.caption).toBe("Good morning!");
      expect(createStoryMock).toHaveBeenCalledTimes(1);
    });

    it("throws INVALID_MEDIA_TYPE if media story lacks objectKey", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          caption: "No photo key",
        }),
      ).rejects.toMatchObject({ code: "INVALID_MEDIA_TYPE" });
    });

    it("rejects a media objectKey outside the owner's folder", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/other-user/photo.jpg",
        }),
      ).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
    });

    it("ignores any client-supplied bucket", async () => {
      const dto: CreateStoryDto & { bucket?: string } = {
        kind: "IMAGE",
        objectKey: "stories/user-owner-1/photo.jpg",
        bucket: "attacker-bucket",
      };

      await service.createStory("user-owner-1", dto);

      expect(getBucketMock).toHaveBeenCalled();
      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "lemon-stories" }),
      );
    });

    it("rejects when the object was not uploaded (HEAD miss)", async () => {
      headObjectMock.mockResolvedValueOnce(null);
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/user-owner-1/photo.jpg",
        }),
      ).rejects.toMatchObject({ code: "OBJECT_NOT_UPLOADED" });
      expect(createStoryMock).not.toHaveBeenCalled();
    });

    it("rejects when the uploaded object exceeds the kind cap", async () => {
      headObjectMock.mockResolvedValueOnce({
        contentLength: 10 * 1024 * 1024 + 1,
        contentType: "image/jpeg",
      });
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/user-owner-1/photo.jpg",
        }),
      ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", params: { maxMb: "10" } });
      expect(createStoryMock).not.toHaveBeenCalled();
    });

    it("rejects when the stored content type is not allowed for the kind", async () => {
      headObjectMock.mockResolvedValueOnce({ contentLength: 1000, contentType: "video/mp4" });
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/user-owner-1/photo.jpg",
        }),
      ).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
      expect(createStoryMock).not.toHaveBeenCalled();
    });

    it("fails closed when storage is down at verify time (no insert)", async () => {
      headObjectMock.mockRejectedValueOnce(new StorageError("s3 down"));
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/user-owner-1/photo.jpg",
        }),
      ).rejects.toBeInstanceOf(StorageError);
      expect(createStoryMock).not.toHaveBeenCalled();
    });

    it("rejects invalid media before touching storage", async () => {
      await expect(service.createStory("user-owner-1", { kind: "IMAGE" })).rejects.toMatchObject({
        code: "INVALID_MEDIA_TYPE",
      });
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/other/photo.jpg",
        }),
      ).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
      expect(headObjectMock).not.toHaveBeenCalled();
    });

    it("stores TEXT stories with a null bucket", async () => {
      await service.createStory("user-owner-1", {
        kind: "TEXT",
        caption: "Good morning!",
      });

      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: null, objectKey: null }),
      );
    });

    it("stores caption and background trimmed", async () => {
      await service.createStory("user-owner-1", {
        kind: "TEXT",
        caption: "  hi  ",
        background: " #fff ",
      });

      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "hi", background: "#fff" }),
      );
    });

    it("rejects TEXT stories whose caption and background are both whitespace-only", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
          caption: "   ",
          background: "   ",
        }),
      ).rejects.toMatchObject({ code: "TEXT_STORY_REQUIRES_CONTENT" });
    });

    it("TEXT story with a client objectKey stores none", async () => {
      const dto: CreateStoryDto & { objectKey?: string } = {
        kind: "TEXT",
        caption: "hello",
        objectKey: "stories/victim/photo.jpg",
      };

      await service.createStory("user-owner-1", dto);

      expect(createStoryMock).toHaveBeenCalledWith(expect.objectContaining({ objectKey: null }));
    });

    it("throws TEXT_STORY_REQUIRES_CONTENT if TEXT story has neither caption nor background", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
        }),
      ).rejects.toMatchObject({ code: "TEXT_STORY_REQUIRES_CONTENT" });
    });

    it("throws TEXT_STORY_REQUIRES_CONTENT if TEXT caption is whitespace-only", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
          caption: "   ",
        }),
      ).rejects.toMatchObject({ code: "TEXT_STORY_REQUIRES_CONTENT" });
    });
  });

  describe("getFeed", () => {
    it("returns cached feed when cache hit occurs", async () => {
      const cachedFeed: UserStoryFeedResponse[] = [
        { user: { id: "u1", username: "u1", fullName: "U1", avatarUrl: null }, stories: [] },
      ];
      getFriendUserIdsMock.mockResolvedValueOnce(["u1"]);
      getBestEffortMock.mockResolvedValueOnce(cachedFeed);

      const result = await service.getFeed("user-viewer-1");
      expect(result).toEqual(cachedFeed);
      expect(findActiveByUserIdsMock).not.toHaveBeenCalled();
    });

    it("revives Date objects from a JSON round-tripped cached feed", async () => {
      const feed: UserStoryFeedResponse[] = [
        {
          user: { id: "u1", username: "u1", fullName: "U1", avatarUrl: null },
          stories: [
            {
              id: "s1",
              userId: "u1",
              kind: "IMAGE",
              bucket: "lemon-stories",
              objectKey: "stories/u1/a.jpg",
              mimeType: "image/jpeg",
              width: 1080,
              height: 1920,
              durationMs: null,
              caption: null,
              background: null,
              createdAt: new Date("2026-10-14T00:00:00Z"),
              expiresAt: new Date("2026-10-15T00:00:00Z"),
            },
          ],
        },
      ];
      getFriendUserIdsMock.mockResolvedValueOnce(["u1"]);
      getBestEffortMock.mockResolvedValueOnce(JSON.parse(JSON.stringify(feed)));

      const result = await service.getFeed("user-viewer-1");
      expect(result[0].stories[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].stories[0].expiresAt).toBeInstanceOf(Date);
      expect(result[0].stories[0].createdAt.getTime()).toBe(
        new Date("2026-10-14T00:00:00Z").getTime(),
      );
    });

    it("queries repository, groups by user, and sets cache on cache miss", async () => {
      const result = await service.getFeed("user-owner-1");

      expect(result).toHaveLength(1);
      expect(result[0].user.id).toBe("user-owner-1");
      expect(result[0].stories).toHaveLength(1);
      expect(findActiveByUserIdsMock).toHaveBeenCalledTimes(1);
      expect(setBestEffortMock).toHaveBeenCalledWith(
        "stories:feed:user-owner-1",
        expect.any(Array),
        60,
      );
    });
  });

  describe("getStoryById", () => {
    it("returns active story for owner", async () => {
      const result = await service.getStoryById("user-owner-1", mockStory.id);
      expect(result.id).toBe(mockStory.id);
    });

    it("returns active story for friend", async () => {
      const result = await service.getStoryById("friend-1", mockStory.id);
      expect(result.id).toBe(mockStory.id);
      expect(isAcceptedFriendMock).toHaveBeenCalledWith("user-owner-1", "friend-1");
    });

    it("throws STORY_VIEW_FORBIDDEN if viewer is not a friend", async () => {
      isAcceptedFriendMock.mockResolvedValueOnce(false);
      await expect(service.getStoryById("stranger-user", mockStory.id)).rejects.toMatchObject({
        code: "STORY_VIEW_FORBIDDEN",
      });
    });

    it("throws STORY_NOT_FOUND if story is not found or expired", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);
      await expect(service.getStoryById("user-owner-1", "non-existent-id")).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });
  });

  describe("viewStory", () => {
    it("marks active story as viewed for friend", async () => {
      await service.viewStory("friend-1", mockStory.id);

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:friend-1");
    });

    it("throws STORY_VIEW_FORBIDDEN if viewer is not a friend", async () => {
      isAcceptedFriendMock.mockResolvedValueOnce(false);
      await expect(service.viewStory("stranger-user", mockStory.id)).rejects.toMatchObject({
        code: "STORY_VIEW_FORBIDDEN",
      });
    });

    it("ignores self-views without polluting the viewers list", async () => {
      await service.viewStory("user-owner-1", mockStory.id);

      expect(markAsViewedMock).not.toHaveBeenCalled();
    });

    it("throws STORY_NOT_FOUND if story not found", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);
      await expect(service.viewStory("friend-1", "bad-id")).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });
  });

  describe("getViewers", () => {
    it("returns viewers list for story owner", async () => {
      const viewers = await service.getViewers("user-owner-1", mockStory.id, undefined, 20);
      expect(viewers.items).toHaveLength(1);
      expect(viewers.items[0].user.id).toBe("viewer-1");
    });

    it("throws STORY_VIEWERS_FORBIDDEN if caller is NOT the story owner", async () => {
      await expect(
        service.getViewers("not-owner-user", mockStory.id, undefined, 20),
      ).rejects.toMatchObject({
        code: "STORY_VIEWERS_FORBIDDEN",
      });
    });

    it("throws STORY_NOT_FOUND if story does not exist", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      await expect(
        service.getViewers("user-owner-1", "not-found-id", undefined, 20),
      ).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });
  });

  describe("deleteStory", () => {
    it("tombstones the story and invalidates owner and friend feeds", async () => {
      await service.deleteStory("user-owner-1", mockStory.id);

      expect(markDeletedMock).toHaveBeenCalledWith(mockStory.id);
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "stories:feed:user-owner-1",
        "stories:feed:friend-1",
        "stories:feed:friend-2",
      ]);
    });

    it("a losing concurrent delete is not found and leaves cache untouched", async () => {
      markDeletedMock.mockResolvedValueOnce(false);

      await expect(service.deleteStory("user-owner-1", mockStory.id)).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
      expect(deleteManyBestEffortMock).not.toHaveBeenCalled();
    });

    it("throws STORY_DELETE_FORBIDDEN if caller is not the owner", async () => {
      await expect(service.deleteStory("intruder-user", mockStory.id)).rejects.toMatchObject({
        code: "STORY_DELETE_FORBIDDEN",
      });
      expect(markDeletedMock).not.toHaveBeenCalled();
    });

    it("throws STORY_NOT_FOUND if the story is missing or already tombstoned", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      await expect(service.deleteStory("user-owner-1", "missing-id")).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
      expect(markDeletedMock).not.toHaveBeenCalled();
    });
  });

  describe("reactStory", () => {
    it("rejects an invalid emoji", async () => {
      await expect(
        service.reactStory("friend-1", mockStory.id, "🎉"),
      ).rejects.toMatchObject({
        code: "INVALID_EMOJI",
      });
    });

    it("throws STORY_NOT_FOUND if the story is inactive or missing", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);

      await expect(
        service.reactStory("friend-1", "non-existent", "❤️"),
      ).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });

    it("throws CANNOT_REACT_OWN_STORY when reacting to own story", async () => {
      await expect(
        service.reactStory("user-owner-1", mockStory.id, "❤️"),
      ).rejects.toMatchObject({
        code: "CANNOT_REACT_OWN_STORY",
      });
    });

    it("throws STORY_REACT_FORBIDDEN when user is not a friend of the author", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-99"]);

      await expect(
        service.reactStory("stranger-user", mockStory.id, "❤️"),
      ).rejects.toMatchObject({
        code: "STORY_REACT_FORBIDDEN",
      });
    });

    it("saves reaction, marks viewed, invalidates feeds, and emits realtime event", async () => {
      const now = new Date("2026-10-14T02:00:00Z");
      addOrUpdateReactionMock.mockResolvedValueOnce({
        storyId: mockStory.id,
        userId: "friend-1",
        emoji: "🔥",
        createdAt: now,
      });
      findUsersByIdsMock.mockResolvedValueOnce(
        new Map([
          [
            "friend-1",
            {
              id: "friend-1",
              username: "friendone",
              fullName: "Friend One",
              avatarUrl: null,
            },
          ],
        ]),
      );

      const result = await service.reactStory("friend-1", mockStory.id, "🔥");

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1");
      expect(addOrUpdateReactionMock).toHaveBeenCalledWith(mockStory.id, "friend-1", "🔥");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:friend-1");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:user-owner-1");
      expect(emitStoryReactionMock).toHaveBeenCalledWith(
        "user-owner-1",
        expect.objectContaining({
          storyId: mockStory.id,
          emoji: "🔥",
          createdAt: now,
          user: expect.objectContaining({ id: "friend-1" }),
        }),
      );
      expect(result).toEqual({
        storyId: mockStory.id,
        emoji: "🔥",
        createdAt: now,
      });
    });
  });

  describe("unreactStory", () => {
    it("throws STORY_NOT_FOUND when story does not exist", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);

      await expect(
        service.unreactStory("friend-1", "non-existent"),
      ).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });

    it("throws CANNOT_REACT_OWN_STORY when unreacting own story", async () => {
      await expect(
        service.unreactStory("user-owner-1", mockStory.id),
      ).rejects.toMatchObject({
        code: "CANNOT_REACT_OWN_STORY",
      });
    });

    it("throws STORY_REACT_FORBIDDEN when caller is not a friend", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-99"]);

      await expect(
        service.unreactStory("stranger-user", mockStory.id),
      ).rejects.toMatchObject({
        code: "STORY_REACT_FORBIDDEN",
      });
    });

    it("deletes reaction and invalidates feed caches on success", async () => {
      await service.unreactStory("friend-1", mockStory.id);

      expect(deleteReactionMock).toHaveBeenCalledWith(mockStory.id, "friend-1");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:friend-1");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:user-owner-1");
    });
  });

  describe("getReactions", () => {
    it("throws STORY_NOT_FOUND when story does not exist", async () => {
      findByIdMock.mockResolvedValueOnce(null);

      await expect(
        service.getReactions("user-owner-1", "non-existent"),
      ).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });

    it("throws STORY_VIEWERS_FORBIDDEN when non-owner requests reactions", async () => {
      await expect(
        service.getReactions("intruder", mockStory.id),
      ).rejects.toMatchObject({
        code: "STORY_VIEWERS_FORBIDDEN",
      });
    });

    it("returns reactions list for story owner", async () => {
      const reactions = [
        {
          user: { id: "friend-1", username: "f1", fullName: "F1", avatarUrl: null },
          emoji: "❤️",
          createdAt: new Date(),
        },
      ];
      findReactionsByStoryIdMock.mockResolvedValueOnce(reactions);

      const result = await service.getReactions("user-owner-1", mockStory.id);

      expect(findReactionsByStoryIdMock).toHaveBeenCalledWith(mockStory.id);
      expect(result).toEqual(reactions);
    });
  });

  describe("replyStory", () => {
    const replyDto = { body: "Looking great!" };

    it("throws STORY_NOT_FOUND when replying to missing or expired story", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);

      await expect(
        service.replyStory("friend-1", "non-existent", replyDto),
      ).rejects.toMatchObject({
        code: "STORY_NOT_FOUND",
      });
    });

    it("throws CANNOT_REPLY_OWN_STORY when replying to own story", async () => {
      await expect(
        service.replyStory("user-owner-1", mockStory.id, replyDto),
      ).rejects.toMatchObject({
        code: "CANNOT_REPLY_OWN_STORY",
      });
    });

    it("throws STORY_REPLY_FORBIDDEN when user is not a friend", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-99"]);

      await expect(
        service.replyStory("stranger", mockStory.id, replyDto),
      ).rejects.toMatchObject({
        code: "STORY_REPLY_FORBIDDEN",
      });
    });

    it("creates 1:1 conversation, sends message with story preview, and marks viewed", async () => {
      const mockMsgResponse = {
        id: "msg-123",
        conversationId: "conv-direct-1",
        senderId: "friend-1",
        kind: "TEXT" as const,
        body: "Looking great!",
        storyId: mockStory.id,
        storyPreview: {
          id: mockStory.id,
          kind: mockStory.kind,
          bucket: mockStory.bucket,
          objectKey: mockStory.objectKey,
          caption: mockStory.caption,
          background: mockStory.background,
        },
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      };
      getOrCreateDirectMock.mockResolvedValueOnce({ id: "conv-direct-1" });
      sendMessageMock.mockResolvedValueOnce(mockMsgResponse);

      const result = await service.replyStory("friend-1", mockStory.id, replyDto);

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1");
      expect(getOrCreateDirectMock).toHaveBeenCalledWith("friend-1", "user-owner-1");
      expect(sendMessageMock).toHaveBeenCalledWith(
        "friend-1",
        "conv-direct-1",
        expect.objectContaining({
          kind: "TEXT",
          body: "Looking great!",
          storyId: mockStory.id,
          storyPreview: expect.objectContaining({
            id: mockStory.id,
            kind: mockStory.kind,
          }),
        }),
      );
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:friend-1");
      expect(result).toEqual(mockMsgResponse);
    });
  });
});

