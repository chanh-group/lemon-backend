import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Logger } from "@nestjs/common";
import { ConversationService } from "../../../../src/domain/conversation/service.js";
import type {
  ConversationRepository,
  ConversationWithPartner,
} from "../../../../src/domain/conversation/repository.js";
import type { UserRepository } from "../../../../src/domain/user/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import { unreadCountKey } from "../../../../src/utils/cache/keys.js";
import type { Redis } from "ioredis";
import type { FriendService } from "../../../../src/domain/friend/service.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

describe("ConversationService", () => {
  let service: ConversationService;

  let findDirectByParticipantsMock: Mock;
  let createDirectConversationMock: Mock;
  let findUserConversationsMock: Mock;
  let existsByIdMock: Mock;
  let findByIdMock: Mock;
  let isMessageInConversationMock: Mock;
  let updateLastReadMock: Mock;
  let countUnreadMock: Mock;
  let countUnreadBatchMock: Mock;

  let findUserByIdMock: Mock;
  let assertCanChatMock: Mock;
  let emitReadUpdatedMock: Mock;
  let joinConversationMock: Mock;
  let redisPipelineMock: Mock;
  let redisPipelineExecMock: Mock;
  let redisPipelineSetMock: Mock;
  let redisDelMock: Mock;
  let redisSetMock: Mock;

  const presenceOnline: [Error | null, unknown] = [
    null,
    JSON.stringify({ state: "online", lastSeen: Date.now() }),
  ];

  const userA = "0193a2b1-0000-7000-8000-000000000001";
  const userB = "0193a2b1-0000-7000-8000-000000000002";
  const convId = "0193a2b1-0000-7000-8000-000000000010";

  const mockConvWithPartner: ConversationWithPartner = {
    id: convId,
    kind: "DIRECT",
    directKey: `${userA}:${userB}`,
    lastMessagePreview: "Hi",
    lastMessageAt: new Date(),
    createdAt: new Date(),
    partner: {
      id: userB,
      username: "user_b",
      fullName: "User B",
      avatarUrl: null,
      isOnline: false,
    },
    unreadCount: 0,
  };

  beforeEach(() => {
    findDirectByParticipantsMock = vi.fn();
    createDirectConversationMock = vi.fn();
    findUserConversationsMock = vi.fn();
    existsByIdMock = vi.fn();
    findByIdMock = vi.fn();
    isMessageInConversationMock = vi.fn().mockResolvedValue(true);
    updateLastReadMock = vi.fn();
    countUnreadMock = vi.fn();
    countUnreadBatchMock = vi.fn().mockResolvedValue(new Map());

    findUserByIdMock = vi.fn();
    assertCanChatMock = vi.fn().mockResolvedValue(undefined);
    emitReadUpdatedMock = vi.fn();
    joinConversationMock = vi.fn();

    const mockConvRepo = {
      findDirectByParticipants: findDirectByParticipantsMock,
      createDirectConversation: createDirectConversationMock,
      findUserConversations: findUserConversationsMock,
      existsById: existsByIdMock,
      findById: findByIdMock,
      isMessageInConversation: isMessageInConversationMock,
      updateLastRead: updateLastReadMock,
      countUnread: countUnreadMock,
      countUnreadByConversationIds: countUnreadBatchMock,
    } as unknown as ConversationRepository;

    const mockUserRepo = {
      findById: findUserByIdMock,
    } as unknown as UserRepository;

    const mockRealtimeService = {
      emitReadUpdated: emitReadUpdatedMock,
      joinConversation: joinConversationMock,
    } as unknown as RealtimeService;
    const mockFriendService = {
      assertCanChat: assertCanChatMock,
      listFriends: vi.fn().mockResolvedValue([{ id: userB }]),
    } as unknown as FriendService;

    redisPipelineExecMock = vi
      .fn()
      .mockResolvedValue([[null, "3"], presenceOnline] satisfies [Error | null, unknown][]);
    redisPipelineSetMock = vi.fn().mockReturnThis();
    redisPipelineMock = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnThis(),
      set: redisPipelineSetMock,
      exec: redisPipelineExecMock,
    });
    redisDelMock = vi.fn().mockResolvedValue(1);
    redisSetMock = vi.fn().mockResolvedValue("OK");

    const mockRedis = {
      pipeline: redisPipelineMock,
      del: redisDelMock,
      set: redisSetMock,
    } as unknown as Redis;

    service = new ConversationService(
      mockConvRepo,
      mockUserRepo,
      mockFriendService,
      mockRealtimeService,
      mockRedis,
    );
  });

  describe("getOrCreateDirect", () => {
    it("throws CANNOT_CHAT_WITH_SELF if userId equals targetUserId", async () => {
      await expect(service.getOrCreateDirect(userA, userA)).rejects.toThrow(
        expect.objectContaining({ code: "CANNOT_CHAT_WITH_SELF" }),
      );
    });

    it("throws BAD_REQUEST if targetUserId is empty", async () => {
      await expect(service.getOrCreateDirect(userA, "")).rejects.toThrow(
        expect.objectContaining({ code: "BAD_REQUEST" }),
      );
    });

    it("throws USER_NOT_FOUND if target user does not exist", async () => {
      findUserByIdMock.mockResolvedValue(null);

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toThrow(
        expect.objectContaining({ code: "USER_NOT_FOUND" }),
      );
    });

    it("does not create a direct conversation before friendship is accepted", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      assertCanChatMock.mockRejectedValue(new BusinessError("FRIENDSHIP_REQUIRED"));

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toMatchObject({
        code: "FRIENDSHIP_REQUIRED",
      });
      expect(findDirectByParticipantsMock).not.toHaveBeenCalled();
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("returns existing conversation if one is already established", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(mockConvWithPartner);

      const result = await service.getOrCreateDirect(userA, userB);

      expect(result.id).toBe(convId);
      expect(result.partner?.id).toBe(userB);
      expect(result).not.toHaveProperty("directKey");
      expect(result).not.toHaveProperty("lastReadMessageId");
      expect(createDirectConversationMock).not.toHaveBeenCalled();
      expect(joinConversationMock).toHaveBeenCalledWith([userA, userB], convId);
    });

    it("creates and returns a new conversation if none exists", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(null);
      createDirectConversationMock.mockResolvedValue(mockConvWithPartner);

      const result = await service.getOrCreateDirect(userA, userB);

      expect(result.id).toBe(convId);
      expect(result).not.toHaveProperty("directKey");
      expect(createDirectConversationMock).toHaveBeenCalledWith(userA, userB);
      expect(joinConversationMock).toHaveBeenCalledWith([userA, userB], convId);
    });

    it("joins both participants when a concurrent insert returns the winning conversation", async () => {
      const raceConvId = "0193a2b1-0000-7000-8000-000000000011";
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(null);
      createDirectConversationMock.mockResolvedValue({ ...mockConvWithPartner, id: raceConvId });

      const result = await service.getOrCreateDirect(userA, userB);

      expect(result.id).toBe(raceConvId);
      expect(createDirectConversationMock).toHaveBeenCalledWith(userA, userB);
      expect(joinConversationMock).toHaveBeenCalledWith([userA, userB], raceConvId);
    });

    it("still returns the new conversation when the realtime join throws", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(null);
      createDirectConversationMock.mockResolvedValue(mockConvWithPartner);
      joinConversationMock.mockImplementation(() => {
        throw new Error("realtime down");
      });
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      try {
        const result = await service.getOrCreateDirect(userA, userB);

        expect(result.id).toBe(convId);
        expect(createDirectConversationMock).toHaveBeenCalledWith(userA, userB);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("listConversations", () => {
    it("returns mapped DTOs without directKey or lastReadMessageId", async () => {
      findUserConversationsMock.mockResolvedValue([{ ...mockConvWithPartner }]);

      const result = await service.listConversations(userA, 20);

      expect(findUserConversationsMock).toHaveBeenCalledWith(userA, 20);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(convId);
      expect(result[0].partner?.isOnline).toBe(true);
      expect(result[0]).not.toHaveProperty("directKey");
      expect(result[0]).not.toHaveProperty("lastReadMessageId");
    });

    it("maps unreadCount and presence enriched from Redis", async () => {
      findUserConversationsMock.mockResolvedValue([{ ...mockConvWithPartner }]);

      const result = await service.listConversations(userA);

      expect(result[0].unreadCount).toBe(3);
      expect(result[0].partner?.isOnline).toBe(true);
      expect(countUnreadMock).not.toHaveBeenCalled();
      expect(redisSetMock).not.toHaveBeenCalled();
    });

    it("rebuilds unreadCount from the database and caches it when Redis has no value", async () => {
      findUserConversationsMock.mockResolvedValue([{ ...mockConvWithPartner }]);
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, "OK"]]);
      countUnreadBatchMock.mockResolvedValue(new Map([[convId, 3]]));

      const result = await service.listConversations(userA);

      expect(countUnreadBatchMock).toHaveBeenCalledWith([convId], userA);
      expect(result[0].unreadCount).toBe(3);
      expect(redisPipelineSetMock).toHaveBeenCalledWith(
        unreadCountKey(userA, convId),
        "3",
        "EX",
        604800,
      );
    });

    it("fails when Redis returns a pipeline command error instead of treating it as a cache miss", async () => {
      findUserConversationsMock.mockResolvedValue([{ ...mockConvWithPartner }]);
      redisPipelineExecMock.mockResolvedValue([[new Error("READONLY"), null], presenceOnline]);

      await expect(service.listConversations(userA)).rejects.toMatchObject({ kind: "unavailable" });

      expect(countUnreadBatchMock).not.toHaveBeenCalled();
    });

    it("rebuilds all missing counters in one batch across conversations", async () => {
      const otherConvId = "0193a2b1-0000-7000-8000-000000000011";
      findUserConversationsMock.mockResolvedValue([
        { ...mockConvWithPartner },
        { ...mockConvWithPartner, id: otherConvId },
      ]);
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], [null, null], presenceOnline, presenceOnline])
        .mockResolvedValueOnce([
          [null, "OK"],
          [null, "OK"],
        ]);
      countUnreadBatchMock.mockResolvedValue(
        new Map([
          [convId, 1],
          [otherConvId, 1],
        ]),
      );

      const result = await service.listConversations(userA);

      expect(countUnreadBatchMock).toHaveBeenCalledWith([convId, otherConvId], userA);
      expect(result[0].unreadCount).toBe(1);
      expect(result[1].unreadCount).toBe(1);
    });

    it("keeps the list usable with unreadCount 0 and warns when the database rebuild fails", async () => {
      findUserConversationsMock.mockResolvedValue([{ ...mockConvWithPartner }]);
      redisPipelineExecMock.mockResolvedValue([[null, null], presenceOnline]);
      countUnreadBatchMock.mockRejectedValue(new Error("db down"));
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      const result = await service.listConversations(userA);

      expect(result).toHaveLength(1);
      expect(result[0].unreadCount).toBe(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("getById", () => {
    it("throws CONVERSATION_NOT_FOUND if conversation does not exist", async () => {
      existsByIdMock.mockResolvedValue(false);

      await expect(service.getById(convId, userA)).rejects.toThrow(
        expect.objectContaining({ code: "CONVERSATION_NOT_FOUND" }),
      );
    });

    it("throws NOT_PARTICIPANT if user is not in the conversation", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue(null);

      await expect(service.getById(convId, userA)).rejects.toThrow(
        expect.objectContaining({ code: "NOT_PARTICIPANT" }),
      );
    });

    it("returns conversation with enriched presence and unreadCount from Redis", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });

      const result = await service.getById(convId, userA);

      expect(result.unreadCount).toBe(3);
      expect(result.partner?.isOnline).toBe(true);
      expect(result).not.toHaveProperty("directKey");
      expect(result).not.toHaveProperty("lastReadMessageId");
      expect(countUnreadMock).not.toHaveBeenCalled();
    });

    it("rebuilds unreadCount from the database and caches it when Redis has no value", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      redisPipelineExecMock.mockResolvedValue([[null, null], presenceOnline]);
      countUnreadMock.mockResolvedValue(4);

      const result = await service.getById(convId, userA);

      expect(countUnreadMock).toHaveBeenCalledWith(convId, userA);
      expect(result.unreadCount).toBe(4);
      expect(redisSetMock).toHaveBeenCalledWith(unreadCountKey(userA, convId), "4", "EX", 604800);
    });

    it("fails when Redis returns a pipeline command error instead of treating it as a cache miss", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      redisPipelineExecMock.mockResolvedValue([[new Error("READONLY"), null], presenceOnline]);

      await expect(service.getById(convId, userA)).rejects.toMatchObject({ kind: "unavailable" });

      expect(countUnreadMock).not.toHaveBeenCalled();
    });

    it("keeps the conversation usable with unreadCount 0 and warns when the database rebuild fails", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      redisPipelineExecMock.mockResolvedValue([[null, null], presenceOnline]);
      countUnreadMock.mockRejectedValue(new Error("db down"));
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      const result = await service.getById(convId, userA);

      expect(result.unreadCount).toBe(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("markAsRead", () => {
    it("updates last read, resets Redis counter, and emits realtime notification", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });

      await service.markAsRead(convId, userA, "msg-123");

      expect(isMessageInConversationMock).toHaveBeenCalledWith(convId, "msg-123");
      expect(updateLastReadMock).toHaveBeenCalledWith(convId, userA, "msg-123");
      expect(redisDelMock).toHaveBeenCalled();
      expect(emitReadUpdatedMock).toHaveBeenCalledWith(
        convId,
        expect.objectContaining({ userId: userA, lastReadMessageId: "msg-123" }),
      );
    });

    it("rejects a lastReadMessageId that does not belong to the conversation", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      isMessageInConversationMock.mockResolvedValue(false);

      await expect(service.markAsRead(convId, userA, "msg-other")).rejects.toThrow(
        expect.objectContaining({ code: "BAD_REQUEST" }),
      );
      expect(isMessageInConversationMock).toHaveBeenCalledWith(convId, "msg-other");
      expect(updateLastReadMock).not.toHaveBeenCalled();
      expect(redisDelMock).not.toHaveBeenCalled();
      expect(emitReadUpdatedMock).not.toHaveBeenCalled();
    });

    it("rejects NOT_PARTICIPANT before checking message membership when the user is not in the conversation", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue(null);

      await expect(service.markAsRead(convId, userA, "msg-123")).rejects.toThrow(
        expect.objectContaining({ code: "NOT_PARTICIPANT" }),
      );
      expect(isMessageInConversationMock).not.toHaveBeenCalled();
      expect(updateLastReadMock).not.toHaveBeenCalled();
    });

    it("rejects CONVERSATION_NOT_FOUND before checking message membership when the conversation does not exist", async () => {
      existsByIdMock.mockResolvedValue(false);

      await expect(service.markAsRead(convId, userA, "msg-123")).rejects.toThrow(
        expect.objectContaining({ code: "CONVERSATION_NOT_FOUND" }),
      );
      expect(isMessageInConversationMock).not.toHaveBeenCalled();
      expect(updateLastReadMock).not.toHaveBeenCalled();
    });

    it("still rejects an empty lastReadMessageId with BAD_REQUEST before any repository lookup", async () => {
      await expect(service.markAsRead(convId, userA, "   ")).rejects.toThrow(
        expect.objectContaining({ code: "BAD_REQUEST" }),
      );
      expect(existsByIdMock).not.toHaveBeenCalled();
      expect(isMessageInConversationMock).not.toHaveBeenCalled();
    });
  });
});
