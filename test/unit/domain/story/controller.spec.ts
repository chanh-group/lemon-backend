import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StoryController } from "../../../../src/domain/story/controller.js";
import { StoryService } from "../../../../src/domain/story/service.js";
import type { CreateStoryDto } from "../../../../src/domain/story/dto/request.js";
import type {
  StoryItemResponse,
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "../../../../src/domain/story/dto/response.js";
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
    ) => Promise<{ items: StoryViewerResponse[]; nextCursor?: string; hasMore: boolean }>
  >;
  let deleteStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;

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
        ) => Promise<{ items: StoryViewerResponse[]; nextCursor?: string; hasMore: boolean }>
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
    deleteStoryMock = vi
      .fn<(userId: string, storyId: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockService = {
      createStory: createStoryMock,
      getFeed: getFeedMock,
      getStoryById: getStoryByIdMock,
      viewStory: viewStoryMock,
      getViewers: getViewersMock,
      deleteStory: deleteStoryMock,
    } as unknown as StoryService;

    controller = new StoryController(mockService);
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
      } as unknown as StoryService;

      const moduleRef = await Test.createTestingModule({
        controllers: [StoryController],
        providers: [{ provide: StoryService, useValue: mockService }],
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
