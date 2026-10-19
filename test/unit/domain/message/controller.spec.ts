import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MessageController } from "../../../../src/domain/message/controller.js";
import { MessageService } from "../../../../src/domain/message/service.js";
import type {
  MessageResponse,
  MessageTimelineResponse,
} from "../../../../src/domain/message/dto/response.js";
import type { SendMessageDto } from "../../../../src/domain/message/dto/request.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

describe("MessageController", () => {
  let controller: MessageController;

  let sendMessageMock: Mock<
    (senderId: string, conversationId: string, dto: SendMessageDto) => Promise<MessageResponse>
  >;
  let getTimelineMock: Mock<
    (
      userId: string,
      conversationId: string,
      cursor?: string,
      limit?: number,
      after?: string,
    ) => Promise<MessageTimelineResponse>
  >;
  let editMessageMock: Mock<
    (userId: string, messageId: string, body: string) => Promise<MessageResponse>
  >;
  let revokeMessageMock: Mock<(userId: string, messageId: string) => Promise<MessageResponse>>;

  const mockUserId = "0193a2b1-0000-7000-8000-000000000001";
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";
  const mockMsgId = "0193a2b1-0000-7000-8000-000000000020";

  const mockMessage: MessageResponse = {
    id: mockMsgId,
    conversationId: mockConvId,
    senderId: mockUserId,
    kind: "TEXT",
    body: "Xin chao!",
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-10-18T10:00:00Z"),
  };

  beforeEach(() => {
    sendMessageMock = vi
      .fn<
        (senderId: string, conversationId: string, dto: SendMessageDto) => Promise<MessageResponse>
      >()
      .mockResolvedValue(mockMessage);

    getTimelineMock = vi
      .fn<
        (
          userId: string,
          conversationId: string,
          cursor?: string,
          limit?: number,
          after?: string,
        ) => Promise<MessageTimelineResponse>
      >()
      .mockResolvedValue({
        items: [mockMessage],
        hasMore: false,
      });

    editMessageMock = vi
      .fn<(userId: string, messageId: string, body: string) => Promise<MessageResponse>>()
      .mockResolvedValue({
        ...mockMessage,
        body: "Sua lai",
        editedAt: new Date("2026-10-18T11:00:00Z"),
      });

    revokeMessageMock = vi
      .fn<(userId: string, messageId: string) => Promise<MessageResponse>>()
      .mockResolvedValue({
        ...mockMessage,
        body: null,
        deletedAt: new Date("2026-10-18T12:00:00Z"),
      });

    const mockService = {
      sendMessage: sendMessageMock,
      getTimeline: getTimelineMock,
      editMessage: editMessageMock,
      revokeMessage: revokeMessageMock,
    } as unknown as MessageService;

    controller = new MessageController(mockService);
  });

  describe("sendMessage", () => {
    it("POST /conversations/:id/messages - wraps the message in the localized created envelope (vi)", async () => {
      const dto: SendMessageDto = { body: "Xin chao!", kind: "TEXT" };
      const res = await controller.sendMessage({ user: { id: mockUserId } }, mockConvId, dto, "vi");

      expect(sendMessageMock).toHaveBeenCalledWith(mockUserId, mockConvId, dto);
      expect(res).toEqual({
        success: true,
        message: "Đã gửi tin nhắn",
        data: mockMessage,
      });
    });

    it("localizes the sent message to en", async () => {
      const dto: SendMessageDto = { body: "Xin chao!", kind: "TEXT" };
      const res = await controller.sendMessage({ user: { id: mockUserId } }, mockConvId, dto, "en");

      expect(res).toEqual({
        success: true,
        message: "Message sent",
        data: mockMessage,
      });
    });
  });

  describe("getMessages", () => {
    it("GET /conversations/:id/messages - wraps the timeline in the OK envelope", async () => {
      const res = await controller.getMessages(
        { user: { id: mockUserId } },
        mockConvId,
        undefined,
        "20",
        undefined,
      );

      expect(getTimelineMock).toHaveBeenCalledWith(
        mockUserId,
        mockConvId,
        undefined,
        20,
        undefined,
      );
      expect(res).toEqual({
        success: true,
        message: "OK",
        data: {
          items: [mockMessage],
          hasMore: false,
        },
      });
    });
  });

  describe("editMessage", () => {
    it("PATCH /messages/:id - wraps the updated message in the localized edited envelope (vi)", async () => {
      const res = await controller.editMessage(
        { user: { id: mockUserId } },
        mockMsgId,
        { body: "Sua lai" },
        "vi",
      );

      expect(editMessageMock).toHaveBeenCalledWith(mockUserId, mockMsgId, "Sua lai");
      expect(res).toEqual({
        success: true,
        message: "Đã chỉnh sửa tin nhắn",
        data: {
          ...mockMessage,
          body: "Sua lai",
          editedAt: new Date("2026-10-18T11:00:00Z"),
        },
      });
    });

    it("localizes the edited message to en", async () => {
      const res = await controller.editMessage(
        { user: { id: mockUserId } },
        mockMsgId,
        { body: "Sua lai" },
        "en",
      );

      expect(res).toEqual({
        success: true,
        message: "Message edited",
        data: {
          ...mockMessage,
          body: "Sua lai",
          editedAt: new Date("2026-10-18T11:00:00Z"),
        },
      });
    });
  });

  describe("revokeMessage", () => {
    it("DELETE /messages/:id - wraps the revoked message in the localized revoked envelope (vi)", async () => {
      const res = await controller.revokeMessage({ user: { id: mockUserId } }, mockMsgId, "vi");

      expect(revokeMessageMock).toHaveBeenCalledWith(mockUserId, mockMsgId);
      expect(res).toEqual({
        success: true,
        message: "Đã thu hồi tin nhắn",
        data: {
          ...mockMessage,
          body: null,
          deletedAt: new Date("2026-10-18T12:00:00Z"),
        },
      });
    });

    it("localizes the revocation message to en", async () => {
      const res = await controller.revokeMessage({ user: { id: mockUserId } }, mockMsgId, "en");

      expect(res).toEqual({
        success: true,
        message: "Message revoked",
        data: {
          ...mockMessage,
          body: null,
          deletedAt: new Date("2026-10-18T12:00:00Z"),
        },
      });
    });
  });

  describe("auth contract", () => {
    it("throws UNAUTHORIZED when req.user is absent", async () => {
      await expect(
        controller.getMessages({}, mockConvId, undefined, undefined, undefined),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("passes the injected id to the service", async () => {
      await controller.getMessages(
        { user: { id: "injected-user" } },
        mockConvId,
        undefined,
        undefined,
        undefined,
      );
      expect(getTimelineMock).toHaveBeenCalledWith(
        "injected-user",
        mockConvId,
        undefined,
        30,
        undefined,
      );
    });
  });

  describe("HTTP request path (@Lang wiring)", () => {
    let app: INestApplication<App>;
    let httpSendMessage: ReturnType<typeof vi.fn>;
    let httpRevokeMessage: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      httpSendMessage = vi.fn();
      httpRevokeMessage = vi.fn();

      const mockService = {
        sendMessage: httpSendMessage,
        getTimeline: vi.fn(),
        editMessage: vi.fn(),
        revokeMessage: httpRevokeMessage,
      } as unknown as MessageService;

      const moduleRef = await Test.createTestingModule({
        controllers: [MessageController],
        providers: [{ provide: MessageService, useValue: mockService }],
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

    it("returns the vi MESSAGE_SENT message when no accept-language header is sent", async () => {
      httpSendMessage.mockResolvedValueOnce(mockMessage);

      const response = await request(app.getHttpServer())
        .post(`/conversations/${mockConvId}/messages`)
        .send({ body: "Xin chao!", kind: "TEXT" })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Đã gửi tin nhắn");
      expect(response.body.data.id).toBe(mockMsgId);
    });

    it("resolves @Lang() from accept-language: en for the revocation message", async () => {
      httpRevokeMessage.mockResolvedValueOnce(mockMessage);

      const response = await request(app.getHttpServer())
        .delete(`/messages/${mockMsgId}`)
        .set("accept-language", "en")
        .expect(200);

      expect(response.body.message).toBe("Message revoked");
    });
  });
});
