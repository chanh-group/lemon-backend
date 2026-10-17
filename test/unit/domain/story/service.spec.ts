import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CacheStoreExt } from "../../../../src/utils/cache/store.js";
import type { StoryRepository } from "../../../../src/domain/story/repository.js";
import { StoryService } from "../../../../src/domain/story/service.js";
import type { NewStory, Story } from "../../../../src/domain/story/schema.js";
import type { CreateStoryDto } from "../../../../src/domain/story/dto/request.js";
import type {
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "../../../../src/domain/story/dto/response.js";

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
  let findViewersByStoryIdMock: Mock<(storyId: string) => Promise<StoryViewerResponse[]>>;
  let findViewedStoryIdsMock: Mock<(userId: string, storyIds: string[]) => Promise<Set<string>>>;
  let markAsViewedMock: Mock<(storyId: string, viewerId: string) => Promise<void>>;
  let deleteMock: Mock<(id: string) => Promise<boolean>>;
  let getFriendUserIdsMock: Mock<(userId: string) => Promise<string[]>>;

  let getBestEffortMock: Mock<(key: string) => Promise<unknown>>;
  let setBestEffortMock: Mock<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>;
  let deleteBestEffortMock: Mock<(key: string) => Promise<void>>;
  let deleteManyBestEffortMock: Mock<(keys: string[]) => Promise<void>>;

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
      .fn<(storyId: string) => Promise<StoryViewerResponse[]>>()
      .mockResolvedValue([
        {
          user: {
            id: "viewer-1",
            username: "friend1",
            fullName: "Friend One",
            avatarUrl: null,
          },
          viewedAt: new Date(),
        },
      ]);
    findViewedStoryIdsMock = vi
      .fn<(userId: string, storyIds: string[]) => Promise<Set<string>>>()
      .mockResolvedValue(new Set());
    markAsViewedMock = vi
      .fn<(storyId: string, viewerId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    deleteMock = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
    getFriendUserIdsMock = vi
      .fn<(userId: string) => Promise<string[]>>()
      .mockResolvedValue(["friend-1", "friend-2"]);

    getBestEffortMock = vi.fn<(key: string) => Promise<unknown>>().mockResolvedValue(null);
    setBestEffortMock = vi
      .fn<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    deleteBestEffortMock = vi.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined);
    deleteManyBestEffortMock = vi
      .fn<(keys: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockRepo: StoryRepository = {
      create: createStoryMock,
      findById: findByIdMock,
      findActiveById: findActiveByIdMock,
      findActiveByUserIds: findActiveByUserIdsMock,
      findUsersByIds: findUsersByIdsMock,
      findViewersByStoryId: findViewersByStoryIdMock,
      findViewedStoryIds: findViewedStoryIdsMock,
      markAsViewed: markAsViewedMock,
      delete: deleteMock,
      getFriendUserIds: getFriendUserIdsMock,
    };

    const mockCache = {
      getBestEffort: getBestEffortMock,
      setBestEffort: setBestEffortMock,
      deleteBestEffort: deleteBestEffortMock,
      deleteManyBestEffort: deleteManyBestEffortMock,
    } as unknown as CacheStoreExt;

    service = new StoryService(mockRepo, mockCache);
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

    it("throws BadRequestException if media story lacks objectKey", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          caption: "No photo key",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a media objectKey outside the owner's folder", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "IMAGE",
          objectKey: "stories/other-user/photo.jpg",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("ignores any client-supplied bucket", async () => {
      const dto: CreateStoryDto & { bucket?: string } = {
        kind: "IMAGE",
        objectKey: "stories/user-owner-1/photo.jpg",
        bucket: "attacker-bucket",
      };

      await service.createStory("user-owner-1", dto);

      expect(createStoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "lemon-stories" }),
      );
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

    it("rejects a caption longer than 500 characters", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
          caption: "a".repeat(501),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects TEXT stories whose caption and background are both whitespace-only", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
          caption: "   ",
          background: "   ",
        }),
      ).rejects.toThrow(BadRequestException);
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

    it("throws BadRequestException if TEXT story has neither caption nor background", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if TEXT caption is whitespace-only", async () => {
      await expect(
        service.createStory("user-owner-1", {
          kind: "TEXT",
          caption: "   ",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getFeed", () => {
    it("returns cached feed when cache hit occurs", async () => {
      const cachedFeed: UserStoryFeedResponse[] = [
        { user: { id: "u1", username: "u1", fullName: "U1", avatarUrl: null }, stories: [] },
      ];
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
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-1"]);
      const result = await service.getStoryById("friend-1", mockStory.id);
      expect(result.id).toBe(mockStory.id);
    });

    it("throws ForbiddenException if viewer is not a friend", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-other"]);
      await expect(service.getStoryById("stranger-user", mockStory.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws NotFoundException if story is not found or expired", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);
      await expect(service.getStoryById("user-owner-1", "non-existent-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("viewStory", () => {
    it("marks active story as viewed for friend", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-1"]);
      await service.viewStory("friend-1", mockStory.id);

      expect(markAsViewedMock).toHaveBeenCalledWith(mockStory.id, "friend-1");
      expect(deleteBestEffortMock).toHaveBeenCalledWith("stories:feed:friend-1");
    });

    it("throws ForbiddenException if viewer is not a friend", async () => {
      getFriendUserIdsMock.mockResolvedValueOnce(["friend-other"]);
      await expect(service.viewStory("stranger-user", mockStory.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("ignores self-views without polluting the viewers list", async () => {
      await service.viewStory("user-owner-1", mockStory.id);

      expect(markAsViewedMock).not.toHaveBeenCalled();
    });

    it("throws NotFoundException if story not found", async () => {
      findActiveByIdMock.mockResolvedValueOnce(null);
      await expect(service.viewStory("friend-1", "bad-id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getViewers", () => {
    it("returns viewers list for story owner", async () => {
      const viewers = await service.getViewers("user-owner-1", mockStory.id);
      expect(viewers).toHaveLength(1);
      expect(viewers[0].user.id).toBe("viewer-1");
    });

    it("throws ForbiddenException if caller is NOT the story owner", async () => {
      await expect(service.getViewers("not-owner-user", mockStory.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws NotFoundException if story does not exist", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      await expect(service.getViewers("user-owner-1", "not-found-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("deleteStory", () => {
    it("deletes story if caller is owner and invalidates cache", async () => {
      await service.deleteStory("user-owner-1", mockStory.id);
      expect(deleteMock).toHaveBeenCalledWith(mockStory.id);
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "stories:feed:user-owner-1",
        "stories:feed:friend-1",
        "stories:feed:friend-2",
      ]);
    });

    it("throws ForbiddenException if caller is not the owner", async () => {
      await expect(service.deleteStory("intruder-user", mockStory.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws NotFoundException if story does not exist", async () => {
      findByIdMock.mockResolvedValueOnce(null);
      await expect(service.deleteStory("user-owner-1", "missing-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
