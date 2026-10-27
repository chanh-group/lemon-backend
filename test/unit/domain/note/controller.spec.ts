import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NoteController } from "../../../../src/domain/note/controller.js";
import { NoteService } from "../../../../src/domain/note/service.js";
import type { UpsertNoteDto } from "../../../../src/domain/note/dto/request.js";
import type {
  NoteResponse,
  UserNoteFeedResponse,
} from "../../../../src/domain/note/dto/response.js";
import { ErrorFilter } from "../../../../src/middleware/error-filter.js";
import type { Logger } from "../../../../src/utils/logger.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

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
    updatedAt: new Date("2026-10-15T00:00:00Z"),
    expiresAt: new Date("2026-10-16T00:00:00Z"),
  };

  beforeEach(() => {
    upsertNoteMock = vi
      .fn<(userId: string, dto: UpsertNoteDto) => Promise<NoteResponse>>()
      .mockResolvedValue(mockNoteResponse);
    getFeedMock = vi.fn<(userId: string) => Promise<UserNoteFeedResponse[]>>().mockResolvedValue([
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
    const dto: UpsertNoteDto = { content: "Sunny day note", background: "#ffcc00" };

    it("delegates to noteService.upsertNote and wraps in envelope (vi)", async () => {
      const result = await controller.upsertNote({ user: { id: "user-1" } }, dto, "vi");

      expect(upsertNoteMock).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({
        success: true,
        message: "Cập nhật note thành công",
        data: mockNoteResponse,
      });
    });

    it("localizes the update message to en", async () => {
      const result = await controller.upsertNote({ user: { id: "user-1" } }, dto, "en");

      expect(result).toEqual({
        success: true,
        message: "Note updated successfully",
        data: mockNoteResponse,
      });
    });
  });

  describe("getFeed", () => {
    it("delegates to noteService.getFeed and wraps in envelope", async () => {
      const result = await controller.getFeed({ user: { id: "user-1" } });

      expect(getFeedMock).toHaveBeenCalledWith("user-1");
      expect(result.success).toBe(true);
      expect(result.message).toBe("OK");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("deleteMyNote", () => {
    it("delegates to noteService.deleteMyNote and returns the vi confirmation envelope", async () => {
      const result = await controller.deleteMyNote({ user: { id: "user-1" } }, "vi");

      expect(deleteMyNoteMock).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        success: true,
        message: "Xoá note thành công",
      });
    });

    it("localizes the deletion message to en", async () => {
      const result = await controller.deleteMyNote({ user: { id: "user-1" } }, "en");

      expect(result).toEqual({
        success: true,
        message: "Note deleted successfully",
      });
    });
  });

  describe("HTTP request path (@Lang wiring)", () => {
    let app: INestApplication<App>;
    let httpUpsertNote: ReturnType<typeof vi.fn>;
    let httpGetFeed: ReturnType<typeof vi.fn>;
    let httpDeleteMyNote: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      httpUpsertNote = vi.fn();
      httpGetFeed = vi.fn();
      httpDeleteMyNote = vi.fn();

      const mockService = {
        upsertNote: httpUpsertNote,
        getFeed: httpGetFeed,
        deleteMyNote: httpDeleteMyNote,
      } as unknown as NoteService;

      const moduleRef = await Test.createTestingModule({
        controllers: [NoteController],
        providers: [{ provide: NoteService, useValue: mockService }],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use((req: Request, _res: Response, next: () => void) => {
        (req as Request & { user?: { id: string } }).user = { id: "user-1" };
        next();
      });
      app.useGlobalPipes(standardSchemaPipe());
      app.useGlobalFilters(
        new ErrorFilter({ log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("resolves @Lang() from accept-language: en for the update message", async () => {
      httpUpsertNote.mockResolvedValueOnce(mockNoteResponse);

      const response = await request(app.getHttpServer())
        .put("/notes")
        .set("accept-language", "en")
        .send({ content: "Sunny day note", background: "#ffcc00" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Note updated successfully");
      expect(response.body.data.id).toBe(mockNoteResponse.id);
    });

    it("returns the vi NOTE_DELETED message when no accept-language header is sent", async () => {
      httpDeleteMyNote.mockResolvedValueOnce(undefined);

      const response = await request(app.getHttpServer()).delete("/notes/me").expect(200);

      expect(response.body).toEqual({ success: true, message: "Xoá note thành công" });
    });

    it("keeps the OK message for the feed even with accept-language: en", async () => {
      httpGetFeed.mockResolvedValueOnce([]);

      const response = await request(app.getHttpServer())
        .get("/notes/feed")
        .set("accept-language", "en")
        .expect(200);

      expect(response.body).toEqual({ success: true, message: "OK", data: [] });
    });

    it("translates a generic validation issue (empty content) through the error filter (vi default)", async () => {
      const response = await request(app.getHttpServer())
        .put("/notes")
        .send({ content: "" })
        .expect(422);

      expect(response.body).toEqual({
        success: false,
        code: "VALIDATION_ERROR",
        message: "content: Giá trị tối thiểu là 1",
      });
      expect(httpUpsertNote).not.toHaveBeenCalled();
    });
  });
});
