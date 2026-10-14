import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StoryController, extractUserIdFromContext } from "../../../../src/domain/story/controller.js";
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
    getFeedMock = vi
      .fn<(userId: string) => Promise<UserStoryFeedResponse[]>>()
      .mockResolvedValue([
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

      const result = await controller.createStory("user-1", dto);

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
      const result = await controller.getFeed("user-1");

      expect(getFeedMock).toHaveBeenCalledWith("user-1");
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("getStoryById", () => {
    it("delegates to storyService.getStoryById and wraps in response envelope", async () => {
      const result = await controller.getStoryById("user-1", mockStoryItem.id);

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
      const result = await controller.viewStory("viewer-1", mockStoryItem.id);

      expect(viewStoryMock).toHaveBeenCalledWith("viewer-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Story marked as viewed",
      });
    });
  });

  describe("getViewers", () => {
    it("delegates to storyService.getViewers and wraps viewers in response envelope", async () => {
      const result = await controller.getViewers("user-1", mockStoryItem.id);

      expect(getViewersMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("deleteStory", () => {
    it("delegates to storyService.deleteStory and returns deletion message", async () => {
      const result = await controller.deleteStory("user-1", mockStoryItem.id);

      expect(deleteStoryMock).toHaveBeenCalledWith("user-1", mockStoryItem.id);
      expect(result).toEqual({
        success: true,
        message: "Story deleted successfully",
      });
    });
  });

  describe("extractUserIdFromContext", () => {
    function createMockContext(request: {
      user?: { id?: string };
      headers: Record<string, string | string[] | undefined>;
    }): ExecutionContext {
      return {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;
    }

    it("extracts userId from request.user.id when present", () => {
      const ctx = createMockContext({
        user: { id: "user-from-auth-guard" },
        headers: {},
      });

      const userId = extractUserIdFromContext(ctx);
      expect(userId).toBe("user-from-auth-guard");
    });

    it("throws UnauthorizedException when request.user is missing (headers are never trusted)", () => {
      const ctx = createMockContext({
        headers: { "x-user-id": "spoofed-user" },
      });

      expect(() => extractUserIdFromContext(ctx)).toThrow(UnauthorizedException);
    });

    it("throws UnauthorizedException when neither user.id nor header is present", () => {
      const ctx = createMockContext({
        headers: {},
      });

      expect(() => extractUserIdFromContext(ctx)).toThrow(UnauthorizedException);
    });
  });
});
