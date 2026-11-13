import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MessageService } from "../../../../src/domain/message/service.js";
import type { MessageRepository } from "../../../../src/domain/message/repository.js";
import type { ConversationRepository } from "../../../../src/domain/conversation/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { Message } from "../../../../src/domain/message/schema.js";
import type { FriendService } from "../../../../src/domain/friend/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";

describe("MessageService", () => {
  let service: MessageService;

  let createMessageMock: Mock;
  let findByIdMock: Mock;
  let findTimelineMock: Mock;
  let updateBodyMock: Mock;
  let softDeleteMock: Mock;
  let resolveWriteMissMock: Mock;
  let reactMessageMock: Mock;
  let emitMessageReactionMock: Mock;

  let getParticipantUserIdsMock: Mock;
  let findConversationByIdMock: Mock;
  let assertCanChatMock: Mock;
  let emitNewMessageMock: Mock;
  let emitMessageUpdatedMock: Mock;
  let emitMessageRevokedMock: Mock;

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
    storyId: null,
    storyPreview: null,
    clientMsgId: null,
    isForwarded: false,
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
    resolveWriteMissMock = vi.fn();
    reactMessageMock = vi.fn();

    getParticipantUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    findConversationByIdMock = vi.fn().mockResolvedValue({ kind: "GROUP" });
    assertCanChatMock = vi.fn().mockResolvedValue(undefined);
    emitNewMessageMock = vi.fn();
    emitMessageUpdatedMock = vi.fn();
    emitMessageRevokedMock = vi.fn();
    emitMessageReactionMock = vi.fn();

    const mockMessageRepo = {
      createMessageWithConversationUpdate: createMessageMock,
      findById: findByIdMock,
      findTimeline: findTimelineMock,
      updateBody: updateBodyMock,
      softDelete: softDeleteMock,
      resolveWriteMiss: resolveWriteMissMock,
      reactMessage: reactMessageMock,
    } as unknown as MessageRepository;

    const mockConvRepo = {
      getParticipantUserIds: getParticipantUserIdsMock,
      findById: findConversationByIdMock,
    } as unknown as ConversationRepository;
    const mockFriendService = {
      assertCanChat: assertCanChatMock,
    } as unknown as FriendService;

    const mockRealtime = {
      emitNewMessage: emitNewMessageMock,
      emitMessageUpdated: emitMessageUpdatedMock,
      emitMessageRevoked: emitMessageRevokedMock,
      emitMessageReaction: emitMessageReactionMock,
    } as unknown as RealtimeService;

    service = new MessageService(mockMessageRepo, mockConvRepo, mockFriendService, mockRealtime);
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

    it("does not send direct messages unless both users are friends", async () => {
      findConversationByIdMock.mockResolvedValue({
        kind: "DIRECT",
        partner: { id: userB },
      });
      assertCanChatMock.mockRejectedValue(new BusinessError("FRIENDSHIP_REQUIRED"));

      await expect(
        service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" }),
      ).rejects.toMatchObject({ code: "FRIENDSHIP_REQUIRED" });
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("passes the direct pair for a transaction-level friendship lock", async () => {
      findConversationByIdMock.mockResolvedValue({ kind: "DIRECT", partner: { id: userB } });
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ requiredFriendship: { userAId: userA, userBId: userB } }),
      );
    });

    it("throws BAD_REQUEST if message body exceeds 4000 characters", async () => {
      await expect(
        service.sendMessage(userA, convId, { body: "a".repeat(4001), kind: "TEXT" }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("successfully creates a message and emits a realtime event", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      const res = await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(res).not.toBe(mockMessage);
      expect(res.id).toBe(msgId);
      expect(res.body).toBe("Hello");
      expect(res).not.toHaveProperty("clientMsgId");
      expect(emitNewMessageMock).toHaveBeenCalledWith(convId, res);
    });

    it("stores a story message with the server decided kind and snapshot", async () => {
      const storyId = "0193a2b1-0000-7000-8000-000000000099";
      const storyMessage = {
        ...mockMessage,
        kind: "STORY_REACTION" as const,
        body: "🔥",
        storyId,
        storyPreview: {
          id: storyId,
          kind: "IMAGE" as const,
          bucket: "lemon-stories",
          objectKey: "stories/u/a.jpg",
          caption: null,
          background: null,
        },
      };
      createMessageMock.mockResolvedValue({ message: storyMessage, isNew: true });

      await service.sendMessage(
        userA,
        convId,
        { body: "🔥", kind: "TEXT" },
        {
          kind: "STORY_REACTION",
          storyId,
          storyPreview: storyMessage.storyPreview,
        },
      );

      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "STORY_REACTION",
          storyId,
          storyPreview: storyMessage.storyPreview,
        }),
      );
    });

    it("does not emit for idempotent retries", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: false });

      const res = await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(res.id).toBe(msgId);
      expect(res).not.toHaveProperty("clientMsgId");
      expect(emitNewMessageMock).not.toHaveBeenCalled();
    });

    it("rejects replyToId that points to a message in another conversation", async () => {
      const otherMsgId = "0193a2b1-0000-7000-8000-000000000021";
      findByIdMock.mockResolvedValue({
        ...mockMessage,
        id: otherMsgId,
        conversationId: "0193a2b1-0000-7000-8000-000000000099",
      });

      await expect(
        service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT", replyToId: otherMsgId }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("rejects replyToId that does not exist", async () => {
      findByIdMock.mockResolvedValue(null);

      await expect(
        service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT", replyToId: msgId }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("accepts replyToId that belongs to the same conversation", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        replyToId: msgId,
      });

      expect(res.id).toBe(msgId);
      expect(findByIdMock).toHaveBeenCalledWith(msgId);
      expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({ replyToId: msgId }));
    });

    it("does not look up a reply message when replyToId is absent", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      await service.sendMessage(userA, convId, { body: "Hello", kind: "TEXT" });

      expect(findByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("getTimeline", () => {
    it("throws NOT_PARTICIPANT if requester is not a member", async () => {
      findConversationByIdMock.mockResolvedValueOnce(null);
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
      expect(getParticipantUserIdsMock).not.toHaveBeenCalled();
      expect(findConversationByIdMock).toHaveBeenCalledWith(convId, userA);
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
      expect(resolveWriteMissMock).not.toHaveBeenCalled();
    });

    it("returns the concurrently revoked message without rewriting or emitting", async () => {
      const deletedAt = new Date();
      const revoked = { ...mockMessage, body: null, deletedAt };
      findByIdMock.mockResolvedValue(mockMessage);
      updateBodyMock.mockResolvedValue(null);
      resolveWriteMissMock.mockResolvedValue(revoked);

      const res = await service.editMessage(userA, msgId, "Updated");

      expect(res.id).toBe(msgId);
      expect(res.body).toBeNull();
      expect(res.deletedAt).toBe(deletedAt);
      expect(res).not.toHaveProperty("clientMsgId");
      expect(updateBodyMock).toHaveBeenCalledTimes(1);
      expect(resolveWriteMissMock).toHaveBeenCalledTimes(1);
      expect(resolveWriteMissMock).toHaveBeenCalledWith(msgId, userA, convId);
      expect(emitMessageUpdatedMock).not.toHaveBeenCalled();
    });

    it("throws MESSAGE_NOT_FOUND when the edit target vanished and cannot be resolved", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      updateBodyMock.mockResolvedValue(null);
      resolveWriteMissMock.mockResolvedValue(null);

      await expect(service.editMessage(userA, msgId, "Updated")).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_NOT_FOUND" }),
      );
      expect(resolveWriteMissMock).toHaveBeenCalledWith(msgId, userA, convId);
      expect(emitMessageUpdatedMock).not.toHaveBeenCalled();
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
      expect(resolveWriteMissMock).not.toHaveBeenCalled();
    });

    it("returns the already-revoked message without re-deleting or emitting", async () => {
      const deletedAt = new Date();
      const revoked = { ...mockMessage, body: null, deletedAt };
      findByIdMock.mockResolvedValue(mockMessage);
      softDeleteMock.mockResolvedValue(null);
      resolveWriteMissMock.mockResolvedValue(revoked);

      const res = await service.revokeMessage(userA, msgId);

      expect(res.id).toBe(msgId);
      expect(res.body).toBeNull();
      expect(res.deletedAt).toBe(deletedAt);
      expect(res).not.toHaveProperty("clientMsgId");
      expect(softDeleteMock).toHaveBeenCalledTimes(1);
      expect(resolveWriteMissMock).toHaveBeenCalledTimes(1);
      expect(resolveWriteMissMock).toHaveBeenCalledWith(msgId, userA, convId);
      expect(emitMessageRevokedMock).not.toHaveBeenCalled();
    });

    it("throws MESSAGE_NOT_FOUND when the revoke target vanished and cannot be resolved", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      softDeleteMock.mockResolvedValue(null);
      resolveWriteMissMock.mockResolvedValue(null);

      await expect(service.revokeMessage(userA, msgId)).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_NOT_FOUND" }),
      );
      expect(resolveWriteMissMock).toHaveBeenCalledWith(msgId, userA, convId);
      expect(emitMessageRevokedMock).not.toHaveBeenCalled();
    });

    it("sends an attachment message without text body successfully and maps storage presigned URLs", async () => {
      const storageMock = {
        getBucket: vi.fn().mockReturnValue("lemon-chat-storage"),
        presignPut: vi.fn(),
        presignGet: vi.fn().mockImplementation(async (params: any) => ({
          downloadUrl: `https://r2.example/${params.disposition}/${params.objectKey}`,
        })),
        headObject: vi
          .fn()
          .mockResolvedValue({ contentLength: 1024, contentType: "application/pdf" }),
        deleteObjects: vi.fn(),
      };

      const serviceWithStorage = new MessageService(
        {
          createMessageWithConversationUpdate: createMessageMock,
          findById: findByIdMock,
        } as any,
        {
          getParticipantUserIds: getParticipantUserIdsMock,
          findById: findConversationByIdMock,
        } as any,
        { assertCanChat: assertCanChatMock } as any,
        { emitNewMessage: emitNewMessageMock } as any,
        storageMock as any,
      );

      getParticipantUserIdsMock.mockResolvedValue([userA, userB]);
      findConversationByIdMock.mockResolvedValue({
        id: convId,
        kind: "DIRECT",
        partner: { id: userB },
      });
      assertCanChatMock.mockResolvedValue(true);

      const createdMsgWithAtt = {
        ...mockMessage,
        kind: "FILE" as const,
        body: null,
        attachments: [
          {
            id: "att-1",
            messageId: msgId,
            kind: "FILE" as const,
            bucket: "lemon-chat-storage",
            objectKey: `chat/${convId}/${userA}/report.pdf`,
            fileName: "Báo Cáo.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            width: null,
            height: null,
            durationMs: null,
            checksum: null,
            createdAt: new Date(),
          },
        ],
      };
      createMessageMock.mockResolvedValue({ message: createdMsgWithAtt, isNew: true });

      const res = await serviceWithStorage.sendMessage(userA, convId, {
        kind: "FILE",
        attachments: [
          {
            objectKey: `chat/${convId}/${userA}/report.pdf`,
            fileName: "Báo Cáo.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
          },
        ],
      });

      expect(res.id).toBe(msgId);
      expect(res.attachments).toHaveLength(1);
      expect(res.attachments![0].previewUrl).toBe(
        `https://r2.example/inline/chat/${convId}/${userA}/report.pdf`,
      );
      expect(res.attachments![0].downloadUrl).toBe(
        `https://r2.example/attachment/chat/${convId}/${userA}/report.pdf`,
      );
      expect(res.attachments![0].fileName).toBe("Báo Cáo.pdf");
    });

    it("forwards only attachments from an accessible source message", async () => {
      const sourceConversationId = "0193a2b1-0000-7000-8000-000000000011";
      const sourceAttachment = {
        id: "att-source",
        messageId: msgId,
        kind: "IMAGE" as const,
        bucket: "lemon-chat-storage",
        objectKey: `chat/${sourceConversationId}/${userB}/photo.png`,
        fileName: "photo.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        width: null,
        height: null,
        durationMs: null,
        checksum: null,
        createdAt: new Date(),
      };
      const mockStorage = {
        headObject: vi.fn().mockResolvedValue({ contentLength: 2048 }),
        presignGet: vi.fn().mockResolvedValue({ downloadUrl: "https://r2.example/forwarded.png" }),
        getBucket: vi.fn().mockReturnValue("lemon-chat-storage"),
      } as unknown as StorageService;

      const serviceWithStorage = new MessageService(
        {
          createMessageWithConversationUpdate: createMessageMock,
          findById: findByIdMock,
        } as any,
        {
          getParticipantUserIds: getParticipantUserIdsMock,
          findById: findConversationByIdMock,
        } as any,
        { assertCanChat: assertCanChatMock } as any,
        { emitNewMessage: emitNewMessageMock } as any,
        mockStorage as any,
      );
      findByIdMock.mockResolvedValue({
        ...mockMessage,
        conversationId: sourceConversationId,
        kind: "IMAGE",
        body: null,
        attachments: [sourceAttachment],
      });

      createMessageMock.mockResolvedValue({
        message: {
          ...mockMessage,
          isForwarded: true,
          attachments: [
            {
              id: "att-fwd-1",
              messageId: msgId,
              bucket: "lemon-chat-storage",
              objectKey: sourceAttachment.objectKey,
              fileName: "photo.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              kind: "IMAGE",
            },
          ],
        },
        isNew: true,
      });

      const res = await serviceWithStorage.sendMessage(userA, convId, {
        kind: "TEXT",
        isForwarded: true,
        sourceMessageId: msgId,
        attachments: [
          {
            objectKey: "chat/unrelated-conversation/other-user/private.png",
            fileName: "private.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            kind: "IMAGE",
          },
        ],
      });

      expect(res.id).toBe(msgId);
      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isForwarded: true,
          attachments: [expect.objectContaining({ objectKey: sourceAttachment.objectKey })],
        }),
      );
    });

    it("does not forward a source message the sender cannot access", async () => {
      const sourceConversationId = "0193a2b1-0000-7000-8000-000000000011";
      findByIdMock.mockResolvedValue({ ...mockMessage, conversationId: sourceConversationId });
      findConversationByIdMock.mockResolvedValueOnce({ kind: "GROUP" }).mockResolvedValueOnce(null);

      await expect(
        service.sendMessage(userA, convId, {
          kind: "TEXT",
          isForwarded: true,
          sourceMessageId: msgId,
        }),
      ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
      expect(createMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("reactToMessage", () => {
    it("calls repo.reactMessage and emits message:reaction to conversation room", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      reactMessageMock.mockResolvedValue({
        conversationId: convId,
        reactions: [{ emoji: "❤️", count: 1, userIds: [userA] }],
      });

      const result = await service.reactToMessage(userA, msgId, "❤️");

      expect(reactMessageMock).toHaveBeenCalledWith(userA, msgId, "❤️");
      expect(emitMessageReactionMock).toHaveBeenCalledWith(convId, {
        messageId: msgId,
        userId: userA,
        emoji: "❤️",
        reactions: [{ emoji: "❤️", count: 1, userIds: [userA] }],
      });
      expect(result).toEqual({
        messageId: msgId,
        reactions: [{ emoji: "❤️", count: 1, userIds: [userA] }],
      });
    });

    it("rejects reactions after a direct conversation is blocked", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      findConversationByIdMock.mockResolvedValue({ kind: "DIRECT", partner: { id: userB } });
      assertCanChatMock.mockRejectedValue(new BusinessError("USER_BLOCKED"));

      await expect(service.reactToMessage(userA, msgId, "❤️")).rejects.toMatchObject({
        code: "USER_BLOCKED",
      });
      expect(reactMessageMock).not.toHaveBeenCalled();
      expect(emitMessageReactionMock).not.toHaveBeenCalled();
    });
  });
});
