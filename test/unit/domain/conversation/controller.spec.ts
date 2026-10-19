import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ConversationController } from "../../../../src/domain/conversation/controller.js";
import { ConversationService } from "../../../../src/domain/conversation/service.js";
import type { ConversationResponse } from "../../../../src/domain/conversation/dto/response.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

describe("ConversationController", () => {
  let controller: ConversationController;
  let getOrCreateDirectMock: Mock<
    (userId: string, targetUserId: string) => Promise<ConversationResponse>
  >;
  let listConversationsMock: Mock<
    (userId: string, limit?: number) => Promise<ConversationResponse[]>
  >;
  let getByIdMock: Mock<(conversationId: string, userId: string) => Promise<ConversationResponse>>;
  let markAsReadMock: Mock<
    (conversationId: string, userId: string, lastReadMessageId: string) => Promise<void>
  >;

  const mockUserId = "0193a2b1-0000-7000-8000-000000000001";
  const mockPartnerId = "0193a2b1-0000-7000-8000-000000000002";
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";

  const mockConversation: ConversationResponse = {
    id: mockConvId,
    kind: "DIRECT",
    lastMessagePreview: "Hello",
    lastMessageAt: new Date("2026-10-18T10:00:00Z"),
    createdAt: new Date("2026-10-18T09:00:00Z"),
    partner: {
      id: mockPartnerId,
      username: "beta_user",
      fullName: "Beta User",
      avatarUrl: null,
      isOnline: true,
    },
    unreadCount: 1,
  };

  beforeEach(() => {
    getOrCreateDirectMock = vi
      .fn<(userId: string, targetUserId: string) => Promise<ConversationResponse>>()
      .mockResolvedValue(mockConversation);

    listConversationsMock = vi
      .fn<(userId: string, limit?: number) => Promise<ConversationResponse[]>>()
      .mockResolvedValue([mockConversation]);

    getByIdMock = vi
      .fn<(conversationId: string, userId: string) => Promise<ConversationResponse>>()
      .mockResolvedValue(mockConversation);

    markAsReadMock = vi
      .fn<(conversationId: string, userId: string, lastReadMessageId: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockService = {
      getOrCreateDirect: getOrCreateDirectMock,
      listConversations: listConversationsMock,
      getById: getByIdMock,
      markAsRead: markAsReadMock,
    } as unknown as ConversationService;

    controller = new ConversationController(mockService);
  });

  describe("createDirect", () => {
    it("POST /conversations/direct - wraps the conversation in the localized created envelope (vi)", async () => {
      const res = await controller.createDirect(
        { user: { id: mockUserId } },
        { targetUserId: mockPartnerId },
        "vi",
      );

      expect(getOrCreateDirectMock).toHaveBeenCalledWith(mockUserId, mockPartnerId);
      expect(res).toEqual({
        success: true,
        message: "Cuộc trò chuyện sẵn sàng",
        data: mockConversation,
      });
    });

    it("localizes the created message to en", async () => {
      const res = await controller.createDirect(
        { user: { id: mockUserId } },
        { targetUserId: mockPartnerId },
        "en",
      );

      expect(res).toEqual({
        success: true,
        message: "Conversation ready",
        data: mockConversation,
      });
    });
  });

  describe("listConversations", () => {
    it("GET /conversations - lists user conversations with default limit 20", async () => {
      const res = await controller.listConversations({ user: { id: mockUserId } }, undefined);

      expect(listConversationsMock).toHaveBeenCalledWith(mockUserId, 20);
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: [mockConversation],
      });
    });

    it("respects the query limit param", async () => {
      await controller.listConversations({ user: { id: mockUserId } }, "50");

      expect(listConversationsMock).toHaveBeenCalledWith(mockUserId, 50);
    });
  });

  describe("getConversation", () => {
    it("GET /conversations/:id - wraps the conversation in the OK envelope", async () => {
      const res = await controller.getConversation({ user: { id: mockUserId } }, mockConvId);

      expect(getByIdMock).toHaveBeenCalledWith(mockConvId, mockUserId);
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: mockConversation,
      });
    });
  });

  describe("markRead", () => {
    const lastReadMessageId = "0193a2b1-0000-7000-8000-000000000099";

    it("POST /conversations/:id/read - returns the vi message-only envelope", async () => {
      const res = await controller.markRead(
        { user: { id: mockUserId } },
        mockConvId,
        { lastReadMessageId },
        "vi",
      );

      expect(markAsReadMock).toHaveBeenCalledWith(mockConvId, mockUserId, lastReadMessageId);
      expect(res).toEqual({
        success: true,
        message: "Đã đánh dấu đã đọc",
      });
    });

    it("localizes the read confirmation to en", async () => {
      const res = await controller.markRead(
        { user: { id: mockUserId } },
        mockConvId,
        { lastReadMessageId },
        "en",
      );

      expect(res).toEqual({
        success: true,
        message: "Messages marked as read",
      });
    });
  });

  describe("auth contract", () => {
    it("throws UNAUTHORIZED when req.user is absent", async () => {
      await expect(controller.listConversations({}, undefined)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("passes the injected id to the service", async () => {
      await controller.getConversation({ user: { id: "injected-user" } }, mockConvId);
      expect(getByIdMock).toHaveBeenCalledWith(mockConvId, "injected-user");
    });
  });

  describe("HTTP request path (@Lang wiring)", () => {
    let app: INestApplication<App>;
    let httpCreateDirect: ReturnType<typeof vi.fn>;
    let httpMarkRead: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      httpCreateDirect = vi.fn();
      httpMarkRead = vi.fn();

      const mockService = {
        getOrCreateDirect: httpCreateDirect,
        listConversations: vi.fn(),
        getById: vi.fn(),
        markAsRead: httpMarkRead,
      } as unknown as ConversationService;

      const moduleRef = await Test.createTestingModule({
        controllers: [ConversationController],
        providers: [{ provide: ConversationService, useValue: mockService }],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use((req: Request, _res: Response, next: () => void) => {
        (req as Request & { user?: { id: string } }).user = { id: mockUserId };
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

    it("returns the vi CONVERSATION_READY message when no accept-language header is sent", async () => {
      httpCreateDirect.mockResolvedValueOnce(mockConversation);

      const response = await request(app.getHttpServer())
        .post("/conversations/direct")
        .send({ targetUserId: mockPartnerId })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Cuộc trò chuyện sẵn sàng");
      expect(response.body.data.id).toBe(mockConvId);
    });

    it("resolves @Lang() from accept-language: en for the read confirmation", async () => {
      httpMarkRead.mockResolvedValueOnce(undefined);

      const response = await request(app.getHttpServer())
        .post(`/conversations/${mockConvId}/read`)
        .set("accept-language", "en")
        .send({ lastReadMessageId: "0193a2b1-0000-7000-8000-000000000099" })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: "Messages marked as read" });
    });
  });
});
