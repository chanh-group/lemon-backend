import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MessageController } from "../../../../src/domain/message/controller.js";
import { MessageService } from "../../../../src/domain/message/service.js";
import type { Message } from "../../../../src/domain/message/schema.js";
import type { MessageTimelineResult } from "../../../../src/domain/message/repository.js";
import type { AuthUser } from "../../../../src/utils/decorators.js";
import type { SendMessageDto } from "../../../../src/domain/message/dto/request.js";

describe("MessageController", () => {
  let controller: MessageController;

  let sendMessageMock: Mock<
    (senderId: string, conversationId: string, dto: SendMessageDto) => Promise<Message>
  >;
  let getTimelineMock: Mock<
    (
      userId: string,
      conversationId: string,
      cursor?: string,
      limit?: number,
      after?: string,
    ) => Promise<MessageTimelineResult>
  >;
  let editMessageMock: Mock<(userId: string, messageId: string, body: string) => Promise<Message>>;
  let revokeMessageMock: Mock<(userId: string, messageId: string) => Promise<Message>>;

  const mockUser: AuthUser = { id: "0193a2b1-0000-7000-8000-000000000001" };
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";
  const mockMsgId = "0193a2b1-0000-7000-8000-000000000020";

  const mockMessage: Message = {
    id: mockMsgId,
    conversationId: mockConvId,
    senderId: mockUser.id,
    kind: "TEXT",
    body: "Xin chao!",
    replyToId: null,
    clientMsgId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-10-18T10:00:00Z"),
  };

  beforeEach(() => {
    sendMessageMock = vi
      .fn<(senderId: string, conversationId: string, dto: SendMessageDto) => Promise<Message>>()
      .mockResolvedValue(mockMessage);

    getTimelineMock = vi
      .fn<
        (
          userId: string,
          conversationId: string,
          cursor?: string,
          limit?: number,
          after?: string,
        ) => Promise<MessageTimelineResult>
      >()
      .mockResolvedValue({
        items: [mockMessage],
        hasMore: false,
      });

    editMessageMock = vi
      .fn<(userId: string, messageId: string, body: string) => Promise<Message>>()
      .mockResolvedValue({ ...mockMessage, body: "Sua lai", editedAt: new Date() });

    revokeMessageMock = vi
      .fn<(userId: string, messageId: string) => Promise<Message>>()
      .mockResolvedValue({ ...mockMessage, deletedAt: new Date() });

    const mockService = {
      sendMessage: sendMessageMock,
      getTimeline: getTimelineMock,
      editMessage: editMessageMock,
      revokeMessage: revokeMessageMock,
    } as unknown as MessageService;

    controller = new MessageController(mockService);
  });

  it("POST /conversations/:id/messages - sends a message", async () => {
    const dto: SendMessageDto = { body: "Xin chao!", kind: "TEXT" };
    const res = await controller.sendMessage(mockUser, mockConvId, dto);

    expect(sendMessageMock).toHaveBeenCalledWith(mockUser.id, mockConvId, dto);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: mockMessage,
    });
  });

  it("GET /conversations/:id/messages - gets message timeline", async () => {
    const res = await controller.getMessages(mockUser, mockConvId, undefined, "20", undefined);

    expect(getTimelineMock).toHaveBeenCalledWith(mockUser.id, mockConvId, undefined, 20, undefined);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: {
        items: [mockMessage],
        hasMore: false,
      },
    });
  });

  it("PATCH /messages/:id - edits own message", async () => {
    const res = await controller.editMessage(mockUser, mockMsgId, { body: "Sua lai" });

    expect(editMessageMock).toHaveBeenCalledWith(mockUser.id, mockMsgId, "Sua lai");
    expect(res.success).toBe(true);
    expect(res.data.body).toBe("Sua lai");
  });

  it("DELETE /messages/:id - revokes message", async () => {
    const res = await controller.revokeMessage(mockUser, mockMsgId);

    expect(revokeMessageMock).toHaveBeenCalledWith(mockUser.id, mockMsgId);
    expect(res).toEqual({
      success: true,
      message: "Đã thu hồi tin nhắn",
      data: expect.objectContaining({ id: mockMsgId }),
    });
  });
});
