import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StoryController } from "../../../../src/domain/story/controller.js";
import { StoryService } from "../../../../src/domain/story/service.js";
import type {
  CreateStoryDto,
  ReplyStoryDto,
  UpdateStorySettingsDto,
} from "../../../../src/domain/story/dto/request.js";
import type {
  StoryItemResponse,
  StoryReactionResponse,
  StoryViewersListResponse,
  MyStoryReactionResponse,
  UserStoryFeedResponse,
  UserStorySettingsResponse,
} from "../../../../src/domain/story/dto/response.js";
import type { CursorPage } from "../../../../src/domain/shared.js";
import type { MessageResponse } from "../../../../src/domain/message/dto/response.js";
import { MemoryRateLimiter, RATE_LIMITER } from "../../../../src/middleware/ratelimit.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

describe("StoryController", () => {
  let controller: StoryController;

  let createStoryMock: Mock<(userId: string, dto: CreateStoryDto) => Promise<StoryItemResponse>>;
  let getFeedMock: Mock<(userId: string) => Promise<UserStoryFeedResponse[]>>;
  let getStoryByIdMock: Mock<(userId: string, storyId: string) => Promise<StoryItemResponse>>;
  let viewStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;
  let getViewersMock: Mock<
    (
      userId: string,
      storyId: string,
      cursor: string | undefined,
      limit: number,
    ) => Promise<StoryViewersListResponse>
  >;
  let deleteStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;
  let reactStoryMock: Mock<
    (userId: string, storyId: string, emoji: string) => Promise<MyStoryReactionResponse>
  >;
  let unreactStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;
  let likeStoryMock: Mock<(userId: string, storyId: string) => Promise<MyStoryReactionResponse>>;
  let unlikeStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;
  let getReactionsMock: Mock<
    (
      userId: string,
      storyId: string,
      cursor: string | undefined,
      limit: number,
      kind?: "REACTION" | "LIKE",
    ) => Promise<CursorPage<StoryReactionResponse>>
  >;
  let replyStoryMock: Mock<
    (userId: string, storyId: string, dto: ReplyStoryDto) => Promise<MessageResponse>
  >;
  let getStorySettingsMock: Mock<(userId: string) => Promise<UserStorySettingsResponse>>;
  let updateStorySettingsMock: Mock<
    (userId: string, dto: UpdateStorySettingsDto) => Promise<UserStorySettingsResponse>
  >;
  let muteAuthorMock: Mock<(userId: string, authorId: string) => Promise<void>>;
  let unmuteAuthorMock: Mock<(userId: string, authorId: string) => Promise<void>>;
  let getMutedAuthorIdsMock: Mock<(userId: string) => Promise<string[]>>;
  let getArchivedStoriesMock: Mock<
    (
      userId: string,
      cursor: string | undefined,
      limit: number,
    ) => Promise<CursorPage<StoryItemResponse>>
  >;

  const mockStoryItem: StoryItemResponse = {
    id: "0193a2b1-0000-7000-8000-000000000001",
    userId: "user-1",
    kind: "IMAGE",
    bucket: "lemon-stories",
    objectKey: "stories/user-1/photo.jpg",
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
  };

  beforeEach(() => {
    createStoryMock = vi
      .fn<(userId: string, dto: CreateStoryDto) => Promise<StoryItemResponse>>()
      .mockResolvedValue(mockStoryItem);
    getFeedMock = vi.fn<(userId: string) => Promise<UserStoryFeedResponse[]>>().mockResolvedValue([
      {
        user: {
          id: "user-1",
          username: "user1",
          fullName: "User One",
          avatarUrl: null,
        },
        stories: [mockStoryItem],
      },
    ]);
    getStoryByIdMock = vi
      .fn<(userId: string, storyId: string) => Promise<StoryItemResponse>>()
      .mockResolvedValue(mockStoryItem);
    viewStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    getViewersMock = vi
      .fn<
        (
          userId: string,
          storyId: string,
          cursor: string | undefined,
          limit: number,
        ) => Promise<StoryViewersListResponse>
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
        nextCursor: null,
        hasMore: false,
        totalViewsCount: 1,
      });
    deleteStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    reactStoryMock = vi
      .fn<(userId: string, storyId: string, emoji: string) => Promise<MyStoryReactionResponse>>()
      .mockResolvedValue({
        storyId: mockStoryItem.id,
        emoji: "❤️",
        kind: "REACTION",
        createdAt: new Date("2026-10-14T01:00:00Z"),
      });
    unreactStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    likeStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<MyStoryReactionResponse>>()
      .mockResolvedValue({
        storyId: mockStoryItem.id,
        emoji: "❤️",
        kind: "LIKE",
        createdAt: new Date("2026-10-14T01:00:00Z"),
      });
    unlikeStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    getReactionsMock = vi
      .fn<
        (
          userId: string,
          storyId: string,
          cursor: string | undefined,
          limit: number,
          kind?: "REACTION" | "LIKE",
        ) => Promise<CursorPage<StoryReactionResponse>>
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
            emoji: "❤️",
            kind: "REACTION",
            createdAt: new Date("2026-10-14T01:00:00Z"),
          },
        ],
        hasMore: false,
      });
    replyStoryMock = vi
      .fn<(userId: string, storyId: string, dto: ReplyStoryDto) => Promise<MessageResponse>>()
      .mockResolvedValue({
        id: "msg-1",
        conversationId: "conv-1",
        senderId: "user-1",
        kind: "TEXT",
        body: "Awesome!",
        storyId: mockStoryItem.id,
        storyPreview: {
          id: mockStoryItem.id,
          kind: "IMAGE",
          bucket: "lemon-stories",
          objectKey: "stories/u/a.jpg",
          caption: null,
          background: null,
        },
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date("2026-10-14T01:00:00Z"),
      });
    getStorySettingsMock = vi.fn().mockResolvedValue({
      viewedReceiptsEnabled: true,
      archiveEnabled: true,
      archiveDurationSecs: null,
    });
    updateStorySettingsMock = vi.fn().mockResolvedValue({
      viewedReceiptsEnabled: false,
      archiveEnabled: true,
      archiveDurationSecs: null,
    });
    muteAuthorMock = vi.fn().mockResolvedValue(undefined);
    unmuteAuthorMock = vi.fn().mockResolvedValue(undefined);
    getMutedAuthorIdsMock = vi.fn().mockResolvedValue([]);
    getArchivedStoriesMock = vi.fn().mockResolvedValue({ items: [], hasMore: false });

    const mockService = {
      createStory: createStoryMock,
      getFeed: getFeedMock,
      getStoryById: getStoryByIdMock,
      viewStory: viewStoryMock,
      getViewers: getViewersMock,
      deleteStory: deleteStoryMock,
      reactStory: reactStoryMock,
      unreactStory: unreactStoryMock,
      likeStory: likeStoryMock,
      unlikeStory: unlikeStoryMock,
      getReactions: getReactionsMock,
      replyStory: replyStoryMock,
      getStorySettings: getStorySettingsMock,
      updateStorySettings: updateStorySettingsMock,
      muteAuthor: muteAuthorMock,
      unmuteAuthor: unmuteAuthorMock,
      getMutedAuthorIds: getMutedAuthorIdsMock,
      getArchivedStories: getArchivedStoriesMock,
    } as unknown as StoryService;

    controller = new StoryController(mockService, new MemoryRateLimiter());
  });

  describe("createStory", () => {
    const dto: CreateStoryDto = {
      kind: "IMAGE",
      objectKey: "stories/user-1/photo.jpg",
      caption: "A sunny day",
    };

    it("delegates to storyService.createStory and wraps in response envelope (vi)", async () => {
      const result = await controller.createStory({ user: { id: "user-1" } }, dto, "vi");

      expect(createStoryMock).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({
        success: true,
        message: "Tạo story thành công",
        data: mockStoryItem,
      });
    });

    it("localizes the created message to en", async () => {
      const result = await controller.createStory({ user: { id: "user-1" } }, dto, "en");

      expect(result).toEqual({
        success: true,
        message: "Story created successfully",
        data: mockStoryItem,
      });
    });
  });

  describe("getFeed", () => {
    it("delegates to storyService.getFeed and wraps in response envelope", async () => {
      const result = await controller.getFeed({ user: { id: "user-1" } });

      expect(getFeedMock).toHaveBeenCalledWith("user-1");
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("getStoryById", () => {
    it("delegates to storyService.getStoryById and wraps in response envelope", async () => {
      const result = await controller.getStoryById({ user: { id: "user-1" } }, mockStoryItem.id);

      expect(getStoryByIdMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "OK",
        data: mockStoryItem,
      });
    });
  });

  describe("viewStory", () => {
    it("delegates to storyService.viewStory and returns the vi confirmation envelope", async () => {
      const result = await controller.viewStory(
        { user: { id: "viewer-1" } },
        mockStoryItem.id,
        "vi",
      );

      expect(viewStoryMock).toHaveBeenCalledWith("viewer-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Đã đánh dấu story là đã xem",
      });
    });

    it("localizes the view confirmation to en", async () => {
      const result = await controller.viewStory(
        { user: { id: "viewer-1" } },
        mockStoryItem.id,
        "en",
      );

      expect(result).toEqual({
        success: true,
        message: "Story marked as viewed",
      });
    });
  });

  describe("getViewers", () => {
    it("delegates to storyService.getViewers and wraps viewers in response envelope", async () => {
      const result = await controller.getViewers({ user: { id: "user-1" } }, mockStoryItem.id);

      expect(getViewersMock).toHaveBeenCalledWith("user-1", mockStoryItem.id, undefined, 20);
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data?.items).toHaveLength(1);
    });
  });

  describe("deleteStory", () => {
    it("delegates to storyService.deleteStory and returns the vi deletion message", async () => {
      const result = await controller.deleteStory(
        { user: { id: "user-1" } },
        mockStoryItem.id,
        "vi",
      );

      expect(deleteStoryMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Xoá story thành công",
      });
    });

    it("localizes the deletion message to en", async () => {
      const result = await controller.deleteStory(
        { user: { id: "user-1" } },
        mockStoryItem.id,
        "en",
      );

      expect(result).toEqual({
        success: true,
        message: "Story deleted successfully",
      });
    });
  });

  describe("reactStory", () => {
    it("delegates to storyService.reactStory and returns withMessage (vi)", async () => {
      const result = await controller.reactStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        { emoji: "❤️" },
        "vi",
      );

      expect(reactStoryMock).toHaveBeenCalledWith("user-2", mockStoryItem.id, "❤️");
      expect(result).toEqual({
        success: true,
        message: "Đã bày tỏ cảm xúc về story",
        data: {
          storyId: mockStoryItem.id,
          emoji: "❤️",
          kind: "REACTION",
          createdAt: new Date("2026-10-14T01:00:00Z"),
        },
      });
    });

    it("localizes reaction message to en", async () => {
      const result = await controller.reactStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        { emoji: "❤️" },
        "en",
      );

      expect(result.message).toBe("Story reaction added");
    });
  });

  describe("unreactStory", () => {
    it("delegates to storyService.unreactStory and returns messageOnly (vi)", async () => {
      const result = await controller.unreactStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        "vi",
      );

      expect(unreactStoryMock).toHaveBeenCalledWith("user-2", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Đã gỡ cảm xúc khỏi story",
      });
    });

    it("localizes unreact message to en", async () => {
      const result = await controller.unreactStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        "en",
      );

      expect(result.message).toBe("Story reaction removed");
    });
  });

  describe("likeStory and unlikeStory", () => {
    it("delegates to storyService.likeStory and returns withMessage", async () => {
      const result = await controller.likeStory({ user: { id: "user-2" } }, mockStoryItem.id, "en");

      expect(likeStoryMock).toHaveBeenCalledWith("user-2", mockStoryItem.id);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Story liked");
      expect(result.data.kind).toBe("LIKE");
    });

    it("delegates to storyService.unlikeStory and returns messageOnly", async () => {
      const result = await controller.unlikeStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        "en",
      );

      expect(unlikeStoryMock).toHaveBeenCalledWith("user-2", mockStoryItem.id);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Story like removed");
    });
  });

  describe("settings endpoints", () => {
    it("gets settings", async () => {
      const result = await controller.getSettings({ user: { id: "user-1" } });
      expect(getStorySettingsMock).toHaveBeenCalledWith("user-1");
      expect(result.data.viewedReceiptsEnabled).toBe(true);
    });

    it("updates settings", async () => {
      const result = await controller.updateSettings(
        { user: { id: "user-1" } },
        { viewedReceiptsEnabled: false },
        "en",
      );
      expect(updateStorySettingsMock).toHaveBeenCalledWith("user-1", {
        viewedReceiptsEnabled: false,
      });
      expect(result.message).toBe("Story settings updated");
    });
  });

  describe("mutes endpoints", () => {
    it("mutes an author", async () => {
      const result = await controller.muteAuthor(
        { user: { id: "user-1" } },
        "0193a2b1-0000-7000-8000-000000000002",
        "en",
      );
      expect(muteAuthorMock).toHaveBeenCalledWith("user-1", "0193a2b1-0000-7000-8000-000000000002");
      expect(result.message).toBe("Story muted");
    });

    it("unmutes an author", async () => {
      const result = await controller.unmuteAuthor(
        { user: { id: "user-1" } },
        "0193a2b1-0000-7000-8000-000000000002",
        "en",
      );
      expect(unmuteAuthorMock).toHaveBeenCalledWith(
        "user-1",
        "0193a2b1-0000-7000-8000-000000000002",
      );
      expect(result.message).toBe("Story unmuted");
    });
  });

  describe("getReactions", () => {
    it("delegates to storyService.getReactions and wraps in response envelope", async () => {
      const result = await controller.getReactions(
        { user: { id: "user-1" } },
        mockStoryItem.id,
        undefined,
        "25",
      );

      expect(getReactionsMock).toHaveBeenCalledWith(
        "user-1",
        mockStoryItem.id,
        undefined,
        25,
        undefined,
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data.items).toHaveLength(1);
    });

    it("throws TOO_MANY_REQUESTS when read rate limit is exceeded", async () => {
      const rejectingLimiter = {
        checkIpLimit: vi.fn(),
        checkEmailLimit: vi.fn(),
        checkMixedLimit: vi.fn().mockResolvedValue(false),
      };
      const limitedController = new StoryController(
        { getReactions: getReactionsMock } as unknown as StoryService,
        rejectingLimiter,
      );

      await expect(
        limitedController.getReactions({ user: { id: "user-1" } }, mockStoryItem.id),
      ).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });
  });

  describe("replyStory", () => {
    const replyDto = { body: "Awesome!" };

    it("delegates to storyService.replyStory and returns withMessage (vi)", async () => {
      const result = await controller.replyStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        replyDto,
        "vi",
      );

      expect(replyStoryMock).toHaveBeenCalledWith("user-2", mockStoryItem.id, replyDto);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Đã trả lời story");
      expect(result.data.body).toBe("Awesome!");
    });

    it("localizes reply message to en", async () => {
      const result = await controller.replyStory(
        { user: { id: "user-2" } },
        mockStoryItem.id,
        replyDto,
        "en",
      );

      expect(result.message).toBe("Story reply sent");
    });
  });

  describe("auth contract", () => {
    it("throws UNAUTHORIZED when req.user is absent", async () => {
      await expect(controller.getFeed({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("passes the injected id to the service", async () => {
      await controller.getFeed({ user: { id: "injected-user" } });
      expect(getFeedMock).toHaveBeenCalledWith("injected-user");
    });
  });

  describe("HTTP request path (@Lang wiring)", () => {
    let app: INestApplication<App>;
    let httpCreateStory: ReturnType<typeof vi.fn>;
    let httpGetFeed: ReturnType<typeof vi.fn>;
    let httpViewStory: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      httpCreateStory = vi.fn();
      httpGetFeed = vi.fn();
      httpViewStory = vi.fn();

      const mockService = {
        createStory: httpCreateStory,
        getFeed: httpGetFeed,
        getStoryById: vi.fn(),
        viewStory: httpViewStory,
        getViewers: vi.fn(),
        deleteStory: vi.fn(),
        reactStory: vi.fn(),
        unreactStory: vi.fn(),
        likeStory: vi.fn(),
        unlikeStory: vi.fn(),
        getReactions: vi.fn(),
        replyStory: vi.fn(),
        getStorySettings: vi.fn(),
        updateStorySettings: vi.fn(),
        muteAuthor: vi.fn(),
        unmuteAuthor: vi.fn(),
        getMutedAuthorIds: vi.fn(),
        getArchivedStories: vi.fn(),
      } as unknown as StoryService;

      const moduleRef = await Test.createTestingModule({
        controllers: [StoryController],
        providers: [
          { provide: StoryService, useValue: mockService },
          { provide: RATE_LIMITER, useValue: new MemoryRateLimiter() },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use((req: Request, _res: Response, next: () => void) => {
        (req as Request & { user?: { id: string } }).user = { id: "user-1" };
        next();
      });
      app.useGlobalPipes(standardSchemaPipe());
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns the vi STORY_CREATED message when no accept-language header is sent", async () => {
      httpCreateStory.mockResolvedValueOnce(mockStoryItem);

      const response = await request(app.getHttpServer())
        .post("/stories")
        .send({ kind: "IMAGE", objectKey: "stories/user-1/photo.jpg", caption: "A sunny day" })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Tạo story thành công");
      expect(response.body.data.id).toBe(mockStoryItem.id);
    });

    it("resolves @Lang() from accept-language: en for the view confirmation", async () => {
      httpViewStory.mockResolvedValueOnce(undefined);

      const response = await request(app.getHttpServer())
        .post(`/stories/${mockStoryItem.id}/view`)
        .set("accept-language", "en")
        .expect(200);

      expect(response.body).toEqual({ success: true, message: "Story marked as viewed" });
    });

    it("keeps the OK message for the feed even with accept-language: en", async () => {
      httpGetFeed.mockResolvedValueOnce([]);

      const response = await request(app.getHttpServer())
        .get("/stories/feed")
        .set("accept-language", "en")
        .expect(200);

      expect(response.body).toEqual({ success: true, message: "OK", data: [] });
    });
  });
});
