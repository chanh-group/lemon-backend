import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MessageService } from "../../../../src/domain/message/service.js";
import type { MessageRepository } from "../../../../src/domain/message/repository.js";
import type { ConversationRepository } from "../../../../src/domain/conversation/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/service.js";
import type { Message } from "../../../../src/domain/message/schema.js";
import type { FriendService } from "../../../../src/domain/friend/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";
import type { StoryRepository } from "../../../../src/domain/story/repository.js";

describe("MessageService", () => {
  let service: MessageService;

  let createMessageMock: Mock;
  let findByIdMock: Mock;
  let findTimelineMock: Mock;
  let findReplyTargetsMock: Mock;
  let updateBodyMock: Mock;
  let softDeleteMock: Mock;
  let hideForUserMock: Mock;
  let resolveWriteMissMock: Mock;
  let reactMessageMock: Mock;
  let findSenderProfilesMock: Mock;
  let canAccessMessageMock: Mock;
  let getGroupMembershipMock: Mock;
  let emitMessageReactionMock: Mock;

  let getParticipantUserIdsMock: Mock;
  let getMessageRecipientUserIdsMock: Mock;
  let isMessageInConversationMock: Mock;
  let isParticipantMock: Mock;
  let findConversationByIdMock: Mock;
  let assertCanChatMock: Mock;
  let emitNewMessageMock: Mock;
  let emitMessageUpdatedMock: Mock;
  let emitMessageRevokedMock: Mock;
  let emitMessageHiddenMock: Mock;
  let findViewableByIdsMock: Mock;
  let mockStoryRepo: StoryRepository;

  const userA = "0193a2b1-0000-7000-8000-000000000001";
  const userB = "0193a2b1-0000-7000-8000-000000000002";
  const outsider = "0193a2b1-0000-7000-8000-000000000099";
  const convId = "0193a2b1-0000-7000-8000-000000000010";
  const msgId = "0193a2b1-0000-7000-8000-000000000020";
  const defaultClientMsgId = "0193259e-7bd8-7d43-902a-c71d6d84351b";

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
    findReplyTargetsMock = vi.fn().mockResolvedValue([]);
    updateBodyMock = vi.fn();
    softDeleteMock = vi.fn();
    hideForUserMock = vi.fn().mockResolvedValue({ conversationId: convId, inserted: true });
    resolveWriteMissMock = vi.fn();
    reactMessageMock = vi.fn();
    findSenderProfilesMock = vi.fn().mockResolvedValue([]);
    findViewableByIdsMock = vi.fn().mockResolvedValue([]);
    canAccessMessageMock = vi.fn().mockResolvedValue(true);
    getGroupMembershipMock = vi.fn().mockResolvedValue(null);

    getParticipantUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    getMessageRecipientUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    isMessageInConversationMock = vi.fn().mockResolvedValue(true);
    isParticipantMock = vi.fn().mockResolvedValue(true);
    findConversationByIdMock = vi
      .fn()
      .mockImplementation((_conversationId: string, userId: string) =>
        userId === outsider ? null : { kind: "GROUP" },
      );
    assertCanChatMock = vi.fn().mockResolvedValue(undefined);
    emitNewMessageMock = vi.fn();
    emitMessageUpdatedMock = vi.fn();
    emitMessageRevokedMock = vi.fn();
    emitMessageHiddenMock = vi.fn();
    emitMessageReactionMock = vi.fn();

    const mockMessageRepo = {
      createMessageWithConversationUpdate: createMessageMock,
      findSenderProfiles: findSenderProfilesMock,
      findById: findByIdMock,
      findTimeline: findTimelineMock,
      findReplyTargets: findReplyTargetsMock,
      updateBody: updateBodyMock,
      softDelete: softDeleteMock,
      hideForUser: hideForUserMock,
      resolveWriteMiss: resolveWriteMissMock,
      reactMessage: reactMessageMock,
    } as unknown as MessageRepository;

    const mockConvRepo = {
      getParticipantUserIds: getParticipantUserIdsMock,
      getMessageRecipientUserIds: getMessageRecipientUserIdsMock,
      isMessageInConversation: isMessageInConversationMock,
      isParticipant: isParticipantMock,
      findById: findConversationByIdMock,
      canAccessMessage: canAccessMessageMock,
      getGroupMembership: getGroupMembershipMock,
    } as unknown as ConversationRepository;
    const mockFriendService = {
      assertCanChat: assertCanChatMock,
    } as unknown as FriendService;

    const mockRealtime = {
      emitNewMessage: emitNewMessageMock,
      emitMessageUpdated: emitMessageUpdatedMock,
      emitMessageRevoked: emitMessageRevokedMock,
      emitMessageHidden: emitMessageHiddenMock,
      emitMessageReaction: emitMessageReactionMock,
    } as unknown as RealtimeService;
    mockStoryRepo = {
      findViewableByIds: findViewableByIdsMock,
    } as unknown as StoryRepository;

    service = new MessageService(
      mockMessageRepo,
      mockConvRepo,
      mockFriendService,
      mockRealtime,
      mockStoryRepo,
    );
  });

  describe("sendMessage", () => {
    it("throws NOT_PARTICIPANT if sender is not in the conversation", async () => {
      findConversationByIdMock.mockResolvedValueOnce(null);

      await expect(
        service.sendMessage(outsider, convId, {
          body: "Hello",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_PARTICIPANT" }));
    });

    it("throws BAD_REQUEST if TEXT message body is empty", async () => {
      await expect(
        service.sendMessage(userA, convId, {
          body: "   ",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("does not send direct messages unless both users are friends", async () => {
      findConversationByIdMock.mockResolvedValue({
        kind: "DIRECT",
        partner: { id: userB },
      });
      assertCanChatMock.mockRejectedValue(new BusinessError("FRIENDSHIP_REQUIRED"));

      await expect(
        service.sendMessage(userA, convId, {
          body: "Hello",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).rejects.toMatchObject({ code: "FRIENDSHIP_REQUIRED" });
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("passes the direct pair for a transaction-level friendship lock", async () => {
      findConversationByIdMock.mockResolvedValue({ kind: "DIRECT", partner: { id: userB } });
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
      });

      expect(createMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ requiredFriendship: { userAId: userA, userBId: userB } }),
      );
    });

    it("throws BAD_REQUEST if message body exceeds 4000 characters", async () => {
      await expect(
        service.sendMessage(userA, convId, {
          body: "a".repeat(4001),
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("accepts 4000 emoji code points even though they exceed 4000 UTF-16 units", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      await expect(
        service.sendMessage(userA, convId, {
          body: "😀".repeat(4000),
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).resolves.toMatchObject({ id: msgId });
    });

    it("throws BAD_REQUEST if the body exceeds 4000 code points", async () => {
      await expect(
        service.sendMessage(userA, convId, {
          body: "😀".repeat(4001),
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    });

    it("successfully creates a message and emits a realtime event", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
      });

      expect(res).not.toBe(mockMessage);
      expect(res.id).toBe(msgId);
      expect(res.body).toBe("Hello");
      expect(res).not.toHaveProperty("clientMsgId");
      const [, emittedPayload] = emitNewMessageMock.mock.calls[0];
      expect(emittedPayload).toEqual(res);
      expect(emittedPayload).not.toHaveProperty("replyTarget");
    });

    it("redacts a reply target per recipient instead of broadcasting the sender view", async () => {
      const replyTargetId = "0193a2b1-0000-7000-8000-000000000021";
      const message = { ...mockMessage, replyToId: replyTargetId };
      createMessageMock.mockResolvedValue({ message, isNew: true });
      canAccessMessageMock.mockResolvedValue(true);
      getMessageRecipientUserIdsMock.mockResolvedValue([userA]);
      findByIdMock.mockResolvedValue({ ...mockMessage, id: replyTargetId });
      findReplyTargetsMock.mockResolvedValue([
        { ...mockMessage, id: replyTargetId, attachments: [] },
      ]);

      await service.sendMessage(userA, convId, {
        body: "Reply",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
        replyToId: replyTargetId,
      });

      const [, broadcastPayload, payloads] = emitNewMessageMock.mock.calls[0];
      expect(broadcastPayload).not.toHaveProperty("replyTarget");
      expect(payloads).toEqual([
        expect.objectContaining({ userId: userA, payload: broadcastPayload }),
        expect.objectContaining({ userId: userB, payload: broadcastPayload }),
      ]);
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
        { body: "🔥", kind: "TEXT", clientMsgId: defaultClientMsgId },
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

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
      });

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
        service.sendMessage(userA, convId, {
          body: "Hello",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
          replyToId: otherMsgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("rejects replyToId that does not exist", async () => {
      findByIdMock.mockResolvedValue(null);

      await expect(
        service.sendMessage(userA, convId, {
          body: "Hello",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
          replyToId: msgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("rejects replyToId that points to a revoked message", async () => {
      findByIdMock.mockResolvedValue({ ...mockMessage, deletedAt: new Date() });

      await expect(
        service.sendMessage(userA, convId, {
          body: "Hello",
          kind: "TEXT",
          clientMsgId: defaultClientMsgId,
          replyToId: msgId,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "MESSAGE_REVOKED" }));
      expect(createMessageMock).not.toHaveBeenCalled();
    });

    it("accepts replyToId that belongs to the same conversation", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
        replyToId: msgId,
      });

      expect(res.id).toBe(msgId);
      expect(findByIdMock).toHaveBeenCalledWith(msgId, false);
      expect(createMessageMock).toHaveBeenCalledWith(expect.objectContaining({ replyToId: msgId }));
    });

    it("refreshes the reply target after persistence", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      findReplyTargetsMock.mockResolvedValue([{ ...mockMessage, attachments: [] }]);
      createMessageMock.mockResolvedValue({
        message: { ...mockMessage, replyToId: msgId },
        isNew: true,
      });

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
        replyToId: msgId,
      });

      expect(findByIdMock).toHaveBeenCalledTimes(1);
      expect(findByIdMock).toHaveBeenCalledWith(msgId, false);
      expect(findReplyTargetsMock).toHaveBeenCalledWith(convId, [msgId], userA);
      expect(res.replyTarget).toMatchObject({ id: msgId, body: "Hello", deletedAt: null });
    });

    it("redacts a reply target revoked after validation from the response and event", async () => {
      const deletedAt = new Date();
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findReplyTargetsMock.mockResolvedValueOnce([
        { ...mockMessage, deletedAt, body: "private old text", attachments: [] },
      ]);
      createMessageMock.mockResolvedValue({
        message: { ...mockMessage, id: "reply", replyToId: msgId },
        isNew: true,
      });

      const res = await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
        replyToId: msgId,
      });

      expect(res.replyTarget).toMatchObject({
        id: msgId,
        body: null,
        storyPreview: null,
        deletedAt,
      });
      const [, emittedPayload, payloads] = emitNewMessageMock.mock.calls[0];
      expect(emittedPayload).not.toHaveProperty("replyTarget");
      for (const entry of payloads as Array<{ payload: unknown }>) {
        expect(entry.payload).toEqual(emittedPayload);
      }
    });

    it("does not look up a reply message when replyToId is absent", async () => {
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });

      await service.sendMessage(userA, convId, {
        body: "Hello",
        kind: "TEXT",
        clientMsgId: defaultClientMsgId,
      });

      expect(findByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("getTimeline", () => {
    it("loads reply targets outside the page and hides revoked content", async () => {
      const target = { ...mockMessage, deletedAt: new Date(), body: "private old text" };
      const reply = { ...mockMessage, id: "reply", replyToId: msgId };
      findTimelineMock.mockResolvedValue({ items: [reply], hasMore: false });
      findReplyTargetsMock.mockResolvedValue([target]);
      const result = await service.getTimeline(userA, convId);
      expect(findReplyTargetsMock).toHaveBeenCalledWith(convId, [msgId], userA);
      expect(result.items[0].replyTarget).toMatchObject({
        id: msgId,
        body: null,
        storyPreview: null,
      });
    });
    it("throws NOT_PARTICIPANT if requester is not a member", async () => {
      findConversationByIdMock.mockResolvedValueOnce(null);
      await expect(service.getTimeline(outsider, convId)).rejects.toThrow(
        expect.objectContaining({ code: "NOT_PARTICIPANT" }),
      );
    });

    it("throws MESSAGE_NOT_FOUND when the cursor is outside the conversation", async () => {
      canAccessMessageMock.mockResolvedValueOnce(false);

      await expect(service.getTimeline(userA, convId, msgId)).rejects.toMatchObject({
        code: "MESSAGE_NOT_FOUND",
      });
      expect(findTimelineMock).not.toHaveBeenCalled();
    });

    it("throws MESSAGE_NOT_FOUND when the after anchor is outside the conversation", async () => {
      canAccessMessageMock.mockResolvedValueOnce(false);

      await expect(
        service.getTimeline(userA, convId, undefined, undefined, msgId),
      ).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND" });
      expect(findTimelineMock).not.toHaveBeenCalled();
    });

    it("skips cursor and after membership checks when neither is provided", async () => {
      findTimelineMock.mockResolvedValue({ items: [], hasMore: false });

      await service.getTimeline(userA, convId);

      expect(canAccessMessageMock).not.toHaveBeenCalled();
    });

    it("returns message timeline for member", async () => {
      findTimelineMock.mockResolvedValue({ items: [mockMessage], hasMore: false });

      const res = await service.getTimeline(userA, convId);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe(msgId);
      expect(res.items[0]).not.toHaveProperty("clientMsgId");
      expect(res.hasMore).toBe(false);
      expect(findTimelineMock).toHaveBeenCalledWith(convId, userA, undefined, undefined, undefined);
      expect(getParticipantUserIdsMock).not.toHaveBeenCalled();
      expect(findConversationByIdMock).toHaveBeenCalledWith(convId, userA);
    });
  });

  describe("getMessageWindow", () => {
    const anchorTarget = { ...mockMessage };

    it("throws MESSAGE_NOT_FOUND when the anchor is outside the conversation", async () => {
      canAccessMessageMock.mockResolvedValueOnce(false);

      await expect(service.getMessageWindow(userA, convId, msgId)).rejects.toMatchObject({
        code: "MESSAGE_NOT_FOUND",
      });
      expect(findTimelineMock).not.toHaveBeenCalled();
    });

    it("throws MESSAGE_NOT_FOUND when the anchor is hidden or outside the history boundary", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([]);

      await expect(service.getMessageWindow(userA, convId, msgId)).rejects.toMatchObject({
        code: "MESSAGE_NOT_FOUND",
      });
      expect(findTimelineMock).not.toHaveBeenCalled();
    });

    it("returns a centered window with the anchor between newer and older messages", async () => {
      const olderMsg = { ...mockMessage, id: "older" };
      const newerMsg = { ...mockMessage, id: "newer1" };
      const newestMsg = { ...mockMessage, id: "newer2" };
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findTimelineMock
        .mockResolvedValueOnce({ items: [olderMsg], hasMore: true, nextCursor: "older" })
        .mockResolvedValueOnce({ items: [newerMsg, newestMsg], hasMore: false });

      const res = await service.getMessageWindow(userA, convId, msgId, 30);

      expect(res.items.map((item) => item.id)).toEqual(["newer2", "newer1", msgId, "older"]);
      expect(res.hasMore).toBe(true);
      expect(res.nextCursor).toBe("older");
      expect(res.hasMoreNewer).toBe(false);
      expect(findTimelineMock).toHaveBeenNthCalledWith(1, convId, userA, msgId, 15);
      expect(findTimelineMock).toHaveBeenNthCalledWith(2, convId, userA, undefined, 14, msgId);
    });

    it("reports hasMoreNewer when messages above the window remain", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findTimelineMock
        .mockResolvedValueOnce({ items: [], hasMore: false })
        .mockResolvedValueOnce({ items: [{ ...mockMessage, id: "newer1" }], hasMore: true });

      const res = await service.getMessageWindow(userA, convId, msgId, 30);

      expect(res.hasMoreNewer).toBe(true);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeUndefined();
    });

    it("clamps the window size to the maximum page size", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findTimelineMock.mockResolvedValue({ items: [], hasMore: false });

      await service.getMessageWindow(userA, convId, msgId, 999);

      expect(findTimelineMock).toHaveBeenNthCalledWith(1, convId, userA, msgId, 25);
      expect(findTimelineMock).toHaveBeenNthCalledWith(2, convId, userA, undefined, 24, msgId);
    });

    it("returns only the anchor when the window size is one", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(mockMessage);

      const res = await service.getMessageWindow(userA, convId, msgId, 1);

      expect(res.items.map((item) => item.id)).toEqual([msgId]);
      expect(res.hasMore).toBe(false);
      expect(res.hasMoreNewer).toBe(false);
      expect(findTimelineMock).not.toHaveBeenCalled();
    });

    it("throws NOT_PARTICIPANT when the side queries deny access", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findTimelineMock.mockResolvedValueOnce({ items: [], hasMore: false, authorized: false });

      await expect(service.getMessageWindow(userA, convId, msgId)).rejects.toMatchObject({
        code: "NOT_PARTICIPANT",
      });
    });

    it("throws MESSAGE_NOT_FOUND when the anchor row disappears before the window loads", async () => {
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]);
      findByIdMock.mockResolvedValueOnce(null);

      await expect(service.getMessageWindow(userA, convId, msgId)).rejects.toMatchObject({
        code: "MESSAGE_NOT_FOUND",
      });
    });

    it("hides revoked reply content on quoted messages inside the window", async () => {
      const quote = { ...mockMessage, id: "quote", deletedAt: new Date(), body: "secret" };
      findReplyTargetsMock.mockResolvedValueOnce([anchorTarget]).mockResolvedValueOnce([quote]);
      findByIdMock.mockResolvedValueOnce(mockMessage);
      findTimelineMock.mockResolvedValueOnce({ items: [], hasMore: false }).mockResolvedValueOnce({
        items: [{ ...mockMessage, id: "newer1", replyToId: "quote" }],
        hasMore: false,
      });

      const res = await service.getMessageWindow(userA, convId, msgId, 30);

      expect(res.items[0].replyTarget).toMatchObject({
        id: "quote",
        body: null,
        storyPreview: null,
      });
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
      expect(emitMessageUpdatedMock).toHaveBeenCalledWith(convId, res, expect.any(Array));
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
      expect(emitMessageRevokedMock).toHaveBeenCalledWith(
        convId,
        { id: msgId, deletedAt },
        expect.any(Array),
      );
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
          findSenderProfiles: findSenderProfilesMock,
          findById: findByIdMock,
        } as any,
        {
          getParticipantUserIds: getParticipantUserIdsMock,
          findById: findConversationByIdMock,
          canAccessMessage: canAccessMessageMock,
          getGroupMembership: getGroupMembershipMock,
        } as any,
        { assertCanChat: assertCanChatMock } as any,
        { emitNewMessage: emitNewMessageMock } as any,
        mockStoryRepo,
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
        clientMsgId: defaultClientMsgId,
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

    it("checks reply lookup while verifying attachment storage", async () => {
      const storage = {
        getBucket: vi.fn().mockReturnValue("lemon-chat-storage"),
        presignGet: vi.fn().mockResolvedValue({ downloadUrl: "https://storage.example/file" }),
        headObject: vi.fn().mockResolvedValue({ contentLength: 1024 }),
      };
      const serviceWithStorage = new MessageService(
        {
          createMessageWithConversationUpdate: createMessageMock,
          findById: findByIdMock,
          findSenderProfiles: findSenderProfilesMock,
        } as any,
        {
          getParticipantUserIds: getParticipantUserIdsMock,
          getMessageRecipientUserIds: getMessageRecipientUserIdsMock,
          canAccessMessage: canAccessMessageMock,
          findById: findConversationByIdMock,
        } as any,
        { assertCanChat: assertCanChatMock } as any,
        { emitNewMessage: emitNewMessageMock } as any,
        mockStoryRepo,
        storage as any,
      );
      let resolveReply!: (message: Message) => void;
      findByIdMock.mockReturnValue(new Promise<Message>((resolve) => (resolveReply = resolve)));
      createMessageMock.mockResolvedValue({ message: mockMessage, isNew: true });
      const request = serviceWithStorage.sendMessage(userA, convId, {
        kind: "FILE",
        clientMsgId: defaultClientMsgId,
        replyToId: msgId,
        attachments: [
          {
            objectKey: `chat/${convId}/${userA}/file.pdf`,
            fileName: "file.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
          },
        ],
      });

      await vi.waitFor(() => expect(storage.headObject).toHaveBeenCalledOnce());
      resolveReply(mockMessage);
      await expect(request).resolves.toMatchObject({ id: msgId });
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
          findSenderProfiles: findSenderProfilesMock,
          findById: findByIdMock,
        } as any,
        {
          getParticipantUserIds: getParticipantUserIdsMock,
          findById: findConversationByIdMock,
          canAccessMessage: canAccessMessageMock,
          getGroupMembership: getGroupMembershipMock,
        } as any,
        { assertCanChat: assertCanChatMock } as any,
        { emitNewMessage: emitNewMessageMock } as any,
        mockStoryRepo,
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
        clientMsgId: defaultClientMsgId,
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
          clientMsgId: defaultClientMsgId,
          isForwarded: true,
          sourceMessageId: msgId,
        }),
      ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
      expect(createMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("hideMessageForMe", () => {
    it("hides an incoming message for only the current participant", async () => {
      await service.hideMessageForMe(userB, msgId);

      expect(hideForUserMock).toHaveBeenCalledWith(msgId, userB);
      expect(emitMessageHiddenMock).toHaveBeenCalledWith(userB, convId, msgId);
      expect(emitMessageRevokedMock).not.toHaveBeenCalled();
    });

    it("does not emit or invalidate for an already hidden message", async () => {
      hideForUserMock.mockResolvedValue({ conversationId: convId, inserted: false });
      await service.hideMessageForMe(userB, msgId);
      expect(emitMessageHiddenMock).not.toHaveBeenCalled();
    });

    it("propagates a not-found result from the transactional permission check", async () => {
      hideForUserMock.mockRejectedValue(new BusinessError("MESSAGE_NOT_FOUND"));
      await expect(service.hideMessageForMe(outsider, msgId)).rejects.toThrow(
        expect.objectContaining({ code: "MESSAGE_NOT_FOUND" }),
      );
      expect(emitMessageHiddenMock).not.toHaveBeenCalled();
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
      expect(emitMessageReactionMock).toHaveBeenCalledWith(
        convId,
        {
          messageId: msgId,
          userId: userA,
          emoji: "❤️",
          reactions: [{ emoji: "❤️", count: 1, userIds: [userA] }],
        },
        expect.any(Array),
      );
      expect(result).toEqual({
        messageId: msgId,
        reactions: [{ emoji: "❤️", count: 1, userIds: [userA] }],
      });
    });

    it("propagates USER_BLOCKED from the reaction transaction without emitting", async () => {
      findByIdMock.mockResolvedValue(mockMessage);
      reactMessageMock.mockRejectedValue(new BusinessError("USER_BLOCKED"));

      await expect(service.reactToMessage(userA, msgId, "❤️")).rejects.toMatchObject({
        code: "USER_BLOCKED",
      });
      expect(emitMessageReactionMock).not.toHaveBeenCalled();
    });
  });

  describe("getReplyTarget", () => {
    it("throws NOT_PARTICIPANT if viewer is not in conversation", async () => {
      isParticipantMock.mockResolvedValueOnce(false);
      await expect(service.getReplyTarget(outsider, convId, msgId)).rejects.toMatchObject({
        code: "NOT_PARTICIPANT",
      });
    });

    it("throws MESSAGE_NOT_FOUND if message is not visible / outside boundary", async () => {
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([]);
      await expect(service.getReplyTarget(userA, convId, msgId)).rejects.toMatchObject({
        code: "MESSAGE_NOT_FOUND",
      });
    });

    it("returns the reply target with sender profile if viewer has access", async () => {
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "TEXT",
          body: "Hello",
          deletedAt: null,
          storyPreview: null,
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([
        { id: userB, username: "bob", fullName: "Bob", avatarUrl: null },
      ]);

      const res = await service.getReplyTarget(userA, convId, msgId);
      expect(res).toMatchObject({
        id: msgId,
        body: "Hello",
        contentCategory: "MESSAGE",
        sender: { id: userB, username: "bob" },
      });
    });

    it("infers category ATTACHMENT and attaches presigned previewAttachment for active image target", async () => {
      const storageMock = {
        presignGet: vi.fn().mockResolvedValue({ downloadUrl: "https://r2.test/inline.jpg" }),
      };
      const serviceWithStorage = new MessageService(
        {
          findReplyTargets: findReplyTargetsMock,
          findSenderProfiles: findSenderProfilesMock,
        } as any,
        { isParticipant: isParticipantMock } as any,
        {} as any,
        {} as any,
        mockStoryRepo,
        storageMock as any,
      );

      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "TEXT",
          body: "Image caption",
          deletedAt: null,
          storyPreview: null,
          attachments: [
            {
              id: "att-1",
              messageId: msgId,
              kind: "IMAGE",
              objectKey: "key-1",
              fileName: "pic.jpg",
              mimeType: "image/jpeg",
              width: 800,
              height: 600,
              durationMs: null,
            },
          ],
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([
        { id: userB, username: "bob", fullName: "Bob", avatarUrl: null },
      ]);

      const res = await serviceWithStorage.getReplyTarget(userA, convId, msgId);
      expect(res.contentCategory).toBe("ATTACHMENT");
      expect(res.previewAttachment).toEqual({
        id: "att-1",
        kind: "IMAGE",
        fileName: "pic.jpg",
        mimeType: "image/jpeg",
        width: 800,
        height: 600,
        durationMs: null,
        previewUrl: "https://r2.test/inline.jpg",
      });
      expect(storageMock.presignGet).toHaveBeenCalledWith(
        expect.objectContaining({
          objectKey: "key-1",
          disposition: "inline",
        }),
      );
    });

    it("preserves contentCategory and strips previewAttachment when target is revoked", async () => {
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "TEXT",
          body: "Revoked caption",
          deletedAt: new Date(),
          storyPreview: null,
          attachments: [
            {
              id: "att-1",
              messageId: msgId,
              kind: "IMAGE",
              objectKey: "key-1",
              fileName: "pic.jpg",
              mimeType: "image/jpeg",
              width: 800,
              height: 600,
              durationMs: null,
            },
          ],
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([
        { id: userB, username: "bob", fullName: "Bob", avatarUrl: null },
      ]);

      const res = await service.getReplyTarget(userA, convId, msgId);
      expect(res.contentCategory).toBe("ATTACHMENT");
      expect(res.body).toBeNull();
      expect(res.previewAttachment).toBeUndefined();
    });

    it("infers VOICE category for messages with only AUDIO attachments", async () => {
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "TEXT",
          body: null,
          deletedAt: null,
          storyPreview: null,
          attachments: [
            {
              id: "att-voice",
              messageId: msgId,
              kind: "AUDIO",
              objectKey: "key-voice",
              fileName: "voice.webm",
              mimeType: "audio/webm",
              width: null,
              height: null,
              durationMs: 4500,
            },
          ],
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([]);

      const res = await service.getReplyTarget(userA, convId, msgId);
      expect(res.contentCategory).toBe("VOICE");
    });

    it("infers STORY category for STORY_REPLY and STORY_REACTION kinds", async () => {
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "STORY_REPLY",
          body: "Nice story!",
          deletedAt: null,
          storyPreview: {
            id: "story-1",
            kind: "IMAGE",
            bucket: "stories",
            objectKey: "story-1.jpg",
            caption: "At the beach",
            background: null,
          },
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([]);

      const res = await service.getReplyTarget(userA, convId, msgId);
      expect(res.contentCategory).toBe("STORY");
    });

    it("resolves a presigned media URL for alive stories and redacts dead ones", async () => {
      const storyPreview = {
        id: "0193a2b1-0000-7000-8000-000000000050",
        kind: "IMAGE" as const,
        bucket: "lemon-stories",
        objectKey: "stories/u/a.jpg",
        caption: "At the beach",
        background: null,
      };
      const storyRow = {
        ...storyPreview,
        userId: userB,
        mimeType: "image/jpeg",
      };
      const storageMock = {
        presignGet: vi.fn().mockResolvedValue({ downloadUrl: "https://r2.test/inline.jpg" }),
      };
      const serviceWithStorage = new MessageService(
        {
          findReplyTargets: findReplyTargetsMock,
          findSenderProfiles: findSenderProfilesMock,
        } as any,
        { isParticipant: isParticipantMock } as any,
        {} as any,
        {} as any,
        mockStoryRepo,
        storageMock as any,
      );
      const target = {
        id: msgId,
        senderId: userB,
        kind: "STORY_REPLY",
        body: "Nice!",
        deletedAt: null,
        storyPreview,
        attachments: [],
      };

      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([target]);
      findSenderProfilesMock.mockResolvedValueOnce([]);
      findViewableByIdsMock.mockResolvedValueOnce([storyRow]);

      const res = await serviceWithStorage.getReplyTarget(userA, convId, msgId);
      expect(res.storyPreview).toMatchObject({
        id: storyPreview.id,
        caption: "At the beach",
        mediaUrl: "https://r2.test/inline.jpg",
      });
      expect(storageMock.presignGet).toHaveBeenCalledWith(
        expect.objectContaining({ objectKey: "stories/u/a.jpg", disposition: "inline" }),
      );

      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([target]);
      findSenderProfilesMock.mockResolvedValueOnce([]);
      findViewableByIdsMock.mockResolvedValueOnce([]);

      const dead = await serviceWithStorage.getReplyTarget(userA, convId, msgId);
      expect(dead.storyPreview).toBeNull();
    });

    it("keeps text story previews without a media URL", async () => {
      const storyPreview = {
        id: "0193a2b1-0000-7000-8000-000000000051",
        kind: "TEXT" as const,
        bucket: null,
        objectKey: null,
        caption: "Hello world",
        background: "#123456",
      };
      isParticipantMock.mockResolvedValueOnce(true);
      findReplyTargetsMock.mockResolvedValueOnce([
        {
          id: msgId,
          senderId: userB,
          kind: "STORY_REPLY",
          body: "Nice!",
          deletedAt: null,
          storyPreview,
          attachments: [],
        },
      ]);
      findSenderProfilesMock.mockResolvedValueOnce([]);
      findViewableByIdsMock.mockResolvedValueOnce([{ ...storyPreview, userId: userB }]);

      const res = await service.getReplyTarget(userA, convId, msgId);
      expect(res.storyPreview).toMatchObject({
        kind: "TEXT",
        caption: "Hello world",
        mediaUrl: null,
      });
    });
  });
});
