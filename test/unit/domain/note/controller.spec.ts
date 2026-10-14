import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NoteController } from "../../../../src/domain/note/controller.js";
import { NoteService } from "../../../../src/domain/note/service.js";
import type { UpsertNoteDto } from "../../../../src/domain/note/dto/request.js";
import type {
  NoteResponse,
  UserNoteFeedResponse,
} from "../../../../src/domain/note/dto/response.js";

describe("NoteController", () => {
  let controller: NoteController;

  let upsertNoteMock: Mock<(userId: string, dto: UpsertNoteDto) => Promise<NoteResponse>>;
  let getFeedMock: Mock<(userId: string) => Promise<UserNoteFeedResponse[]>>;
  let deleteMyNoteMock: Mock<(userId: string) => Promise<void>>;

  const mockNoteResponse: NoteResponse = {
    id: "0193a2b1-0000-7000-8000-000000000002",
    userId: "user-1",
    content: "Sunny day note",
    background: "#ffcc00",
    createdAt: new Date("2026-10-15T00:00:00Z"),
    expiresAt: new Date("2026-10-16T00:00:00Z"),
  };

  beforeEach(() => {
    upsertNoteMock = vi
      .fn<(userId: string, dto: UpsertNoteDto) => Promise<NoteResponse>>()
      .mockResolvedValue(mockNoteResponse);
    getFeedMock = vi
      .fn<(userId: string) => Promise<UserNoteFeedResponse[]>>()
      .mockResolvedValue([
        {
          user: {
            id: "user-1",
            username: "user1",
            fullName: "User One",
            avatarUrl: null,
          },
          note: mockNoteResponse,
        },
      ]);
    deleteMyNoteMock = vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined);

    const mockService = {
      upsertNote: upsertNoteMock,
      getFeed: getFeedMock,
      deleteMyNote: deleteMyNoteMock,
    } as unknown as NoteService;

    controller = new NoteController(mockService);
  });

  describe("upsertNote", () => {
    it("delegates to noteService.upsertNote and wraps in envelope", async () => {
      const dto: UpsertNoteDto = { content: "Sunny day note", background: "#ffcc00" };
      const result = await controller.upsertNote("user-1", dto);

      expect(upsertNoteMock).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({
        success: true,
        message: "Note updated successfully",
        data: mockNoteResponse,
      });
    });
  });

  describe("getFeed", () => {
    it("delegates to noteService.getFeed and wraps in envelope", async () => {
      const result = await controller.getFeed("user-1");

      expect(getFeedMock).toHaveBeenCalledWith("user-1");
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("deleteMyNote", () => {
    it("delegates to noteService.deleteMyNote and returns confirmation envelope", async () => {
      const result = await controller.deleteMyNote("user-1");

      expect(deleteMyNoteMock).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        success: true,
        message: "Note deleted successfully",
      });
    });
  });
});
