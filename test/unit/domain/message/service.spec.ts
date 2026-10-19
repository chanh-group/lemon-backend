import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MessageService } from "../../../../src/domain/message/service.js";
import type { MessageRepository } from "../../../../src/domain/message/repository.js";
import type { ConversationRepository } from "../../../../src/domain/conversation/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { Redis } from "ioredis";
import type { Message } from "../../../../src/domain/message/schema.js";
import { unreadCountKey } from "../../../../src/utils/cache/keys.js";

describe("MessageService", () => {
  let service: MessageService;

  let createMessageMock: Mock;
  let findByIdMock: Mock;
  let findTimelineMock: Mock;
  let updateBodyMock: Mock;
  let softDeleteMock: Mock;

  let getParticipantUserIdsMock: Mock;
  let emitNewMessageMock: Mock;
  let emitMessageUpdatedMock: Mock;
  let emitMessageRevokedMock: Mock;

  let redisPipelineMock: Mock;
  let redisIncrMock: Mock;
  let redisExpireMock: Mock;

  const userA = "0193a2b1-0000-7000-8000-000000000001";
  const userB = "0193a2b1-0000-7000-8000-000000000002";
  const outsider = "0193a2b1-0000-7000-8000-000000000099";
  const convId = "0193a2b1-0000-7000-8000-000000000010";
  const msgId = "0193a2b1-0000-7000-8000-000000000020";

  const mockMessage: Message = {
    id: msgId,
    conversationId: convId,
    senderId: userA,
    kind: "TEXT",
    body: "Hello",
    replyToId: null,
    clientMsgId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    createMessageMock = vi.fn();
    findByIdMock = vi.fn();
    findTimelineMock = vi.fn();
    updateBodyMock = vi.fn();
    softDeleteMock = vi.fn();

    getParticipantUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    emitNewMessageMock = vi.fn();
    emitMessageUpdatedMock = vi.fn();
    emitMessageRevokedMock = vi.fn();

    const mockMessageRepo = {
      createMessageWithConversationUpdate: createMessageMock,
      findById: findByIdMock,
      findTimeline: findTimelineMock,
      updateBody: updateBodyMock,
      softDelete: softDeleteMock,
    } as unknown as MessageRepository;

    const mockConvRepo = {
      getParticipantUserIds: getParticipantUserIdsMock,
    } as unknown as ConversationRepository;

    const mockRealtime = {
      emitNewMessage: emitNewMessageMock,
      emitMessageUpdated: emitMessageUpdatedMock,
      emitMessageRevoked: emitMessageRevokedMock,
    } as unknown as RealtimeService;

    redisIncrMock = vi.fn().mockReturnThis();
    redisExpireMock = vi.fn().mockReturnThis();
    redisPipelineMock = vi.fn().mockReturnValue({
      incr: redisIncrMock,
      expire: redisExpireMock,
      exec: vi.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
      ]),
    });

    const mockRedis = {
      pipeline: redisPipelineMock,
    } as unknown as Redis;

    service = new MessageService(mockMessageRepo, mockConvRepo, mockRealtime, mockRedis);
  });

  describe("sendMessage", () => {
    it("throws NOT_PARTICIPANT if sender is not in the conversation", async () => {
      await expect(
        service.sendMessage(outsider, convId, { body: "Hello", kind: "TEXT" }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_PARTICIPANT" }));
    });

    it("throws BAD_REQUEST if TEXT message body is empty", async () => {
      await expect(
        service.sendMessage(userA, convId, { body: "   ", kind: "TEXT" }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("throws BAD_REQUEST if message body exceeds 4000 characters", async () => {
      await expect(
        service.sendMessage(userA, convId, { body: "a".repeat(4001), kind: "TEXT" }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("successfully creates message, increments Redis counter, and emits realtime event", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      const res = await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(res).not.toBe(mockMessage);
      expect(res.id).toBe(msgId);
      expect(res.body).toBe("Hello");
      expect(res).not.toHaveProperty("clientMsgId");
      expect(redisPipelineMock).toHaveBeenCalled();
      expect(redisIncrMock).toHaveBeenCalledTimes(1);
      expect(redisIncrMock).toHaveBeenCalledWith(unreadCountKey(userB, convId));
      expect(redisExpireMock).toHaveBeenCalledTimes(1);
      expect(redisExpireMock).toHaveBeenCalledWith(unreadCountKey(userB, convId), 604800);
      expect(emitNewMessageMock).toHaveBeenCalledWith(convId, res);
    });

    it("does not emit or increment unread for idempotent retries", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: false });

      const res = await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(res.id).toBe(msgId);
      expect(res).not.toHaveProperty("clientMsgId");
      expect(redisPipelineMock).not.toHaveBeenCalled();
      expect(redisIncrMock).not.toHaveBeenCalled();
      expect(redisExpireMock).not.toHaveBeenCalled();
      expect(emitNewMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("getTimeline", () => {
    it("throws NOT_PARTICIPANT if requester is not a member", async () => {
      await expect(service.getTimeline(outsider, convId)).rejects.toThrow(
        expect.objectContaining({ code: "NOT_PARTICIPANT" }),
      );
    });

    it("returns message timeline for member", async () => {
      findTimelineMock.mockResolvedValue({ items: [mockMessage], hasMore: false });

      const res = await service.getTimeline(userA, convId);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe(msgId);
      expect(res.items[0]).not.toHaveProperty("clientMsgId");
      expect(res.hasMore).toBe(false);
      expect(findTimelineMock).toHaveBeenCalledWith(convId, undefined, undefined, undefined);
    });
  });

  describe("editMessage", () => {
    it("throws MESSAGE_NOT_FOUND if message does not exist", async () => {
      findByIdMock.mockResolvedValue(null);

      await expect(service.editMessage(userA, msgId, "New text")).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_NOT_FOUND" }),
      );
    });

    it("throws MESSAGE_REVOKED if message was already soft-deleted", async () => {
      findByIdMock.mockResolvedValue({ ...mockMessage, deletedAt: new Date() });

      await expect(service.editMessage(userA, msgId, "New text")).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_REVOKED" }),
      );
    });

    it("throws FORBIDDEN if another user tries to edit the message", async () => {
      findByIdMock.mockResolvedValue(mockMessage);

      await expect(service.editMessage(userB, msgId, "Hacked")).rejects.toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });

    it("throws BAD_REQUEST if message kind is not TEXT", async () => {
      findByIdMock.mockResolvedValue({ ...mockMessage, kind: "IMAGE" });

      await expect(service.editMessage(userA, msgId, "Caption")).rejects.toThrow(
        expect.objectContaining({ code: "BAD_REQUEST" }),
      );
    });

    it("successfully edits message and emits realtime event", async () => {
      const updatedMsg = { ...mockMessage, body: "Updated", editedAt: new Date() };
      findByIdMock.mockResolvedValue(mockMessage);
      updateBodyMock.mockResolvedValue(updatedMsg);

      const res = await service.editMessage(userA, msgId, "Updated");

      expect(res.body).toBe("Updated");
      expect(res).not.toHaveProperty("clientMsgId");
      expect(emitMessageUpdatedMock).toHaveBeenCalledWith(convId, res);
    });
  });

  describe("revokeMessage", () => {
    it("throws MESSAGE_NOT_FOUND if message does not exist", async () => {
      findByIdMock.mockResolvedValue(null);

      await expect(service.revokeMessage(userA, msgId)).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_NOT_FOUND" }),
      );
    });

    it("throws MESSAGE_REVOKED if already deleted", async () => {
      findByIdMock.mockResolvedValue({ ...mockMessage, deletedAt: new Date() });

      await expect(service.revokeMessage(userA, msgId)).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_REVOKED" }),
      );
    });

    it("throws FORBIDDEN if someone else tries to revoke", async () => {
      findByIdMock.mockResolvedValue(mockMessage);

      await expect(service.revokeMessage(userB, msgId)).rejects.toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });

    it("successfully soft-deletes and emits realtime event", async () => {
      const deletedAt = new Date();
      const revokedMsg = { ...mockMessage, deletedAt };
      findByIdMock.mockResolvedValue(mockMessage);
      softDeleteMock.mockResolvedValue(revokedMsg);

      const res = await service.revokeMessage(userA, msgId);

      expect(res.deletedAt).toBe(deletedAt);
      expect(res.body).toBeNull();
      expect(res).not.toHaveProperty("clientMsgId");
      expect(emitMessageRevokedMock).toHaveBeenCalledWith(convId, { id: msgId, deletedAt });
    });
  });
});
