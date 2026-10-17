import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StoryController } from "../../../../src/domain/story/controller.js";
import { StoryService } from "../../../../src/domain/story/service.js";
import type { CreateStoryDto } from "../../../../src/domain/story/dto/request.js";
import type {
  StoryItemResponse,
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "../../../../src/domain/story/dto/response.js";

describe("StoryController", () => {
  let controller: StoryController;

  let createStoryMock: Mock<(userId: string, dto: CreateStoryDto) => Promise<StoryItemResponse>>;
  let getFeedMock: Mock<(userId: string) => Promise<UserStoryFeedResponse[]>>;
  let getStoryByIdMock: Mock<(userId: string, storyId: string) => Promise<StoryItemResponse>>;
  let viewStoryMock: Mock<(userId: string, storyId: string) => Promise<void>>;
  let getViewersMock: Mock<(userId: string, storyId: string) => Promise<StoryViewerResponse[]>>;
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
      .fn<(userId: string, storyId: string) => Promise<StoryViewerResponse[]>>()
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
    it("delegates to storyService.createStory and wraps in response envelope", async () => {
      const dto: CreateStoryDto = {
        kind: "IMAGE",
        objectKey: "stories/user-1/photo.jpg",
        caption: "A sunny day",
      };

      const result = await controller.createStory({ user: { id: "user-1" } }, dto);

      expect(createStoryMock).toHaveBeenCalledWith("user-1", dto);
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
    it("delegates to storyService.viewStory and returns confirmation envelope", async () => {
      const result = await controller.viewStory({ user: { id: "viewer-1" } }, mockStoryItem.id);

      expect(viewStoryMock).toHaveBeenCalledWith("viewer-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Story marked as viewed",
      });
    });
  });

  describe("getViewers", () => {
    it("delegates to storyService.getViewers and wraps viewers in response envelope", async () => {
      const result = await controller.getViewers({ user: { id: "user-1" } }, mockStoryItem.id);

      expect(getViewersMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("deleteStory", () => {
    it("delegates to storyService.deleteStory and returns deletion message", async () => {
      const result = await controller.deleteStory({ user: { id: "user-1" } }, mockStoryItem.id);

      expect(deleteStoryMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
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
});
