import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ConversationService } from "../../../../src/domain/conversation/service.js";
import type {
  ConversationRepository,
  ConversationWithPartner,
} from "../../../../src/domain/conversation/repository.js";
import type { UserRepository } from "../../../../src/domain/user/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { Redis } from "ioredis";

describe("ConversationService", () => {
  let service: ConversationService;

  let findDirectByParticipantsMock: Mock;
  let createDirectConversationMock: Mock;
  let findUserConversationsMock: Mock;
  let existsByIdMock: Mock;
  let findByIdMock: Mock;
  let updateLastReadMock: Mock;

  let findUserByIdMock: Mock;
  let emitReadUpdatedMock: Mock;
  let redisPipelineMock: Mock;
  let redisDelMock: Mock;

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
    updateLastReadMock = vi.fn();

    findUserByIdMock = vi.fn();
    emitReadUpdatedMock = vi.fn();

    const mockConvRepo = {
      findDirectByParticipants: findDirectByParticipantsMock,
      createDirectConversation: createDirectConversationMock,
      findUserConversations: findUserConversationsMock,
      existsById: existsByIdMock,
      findById: findByIdMock,
      updateLastRead: updateLastReadMock,
    } as unknown as ConversationRepository;

    const mockUserRepo = {
      findById: findUserByIdMock,
    } as unknown as UserRepository;

    const mockRealtimeService = {
      emitReadUpdated: emitReadUpdatedMock,
    } as unknown as RealtimeService;

    redisPipelineMock = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, "3"], // unreadCount
        [null, JSON.stringify({ state: "online", lastSeen: Date.now() })], // presence
      ]),
    });
    redisDelMock = vi.fn().mockResolvedValue(1);

    const mockRedis = {
      pipeline: redisPipelineMock,
      del: redisDelMock,
    } as unknown as Redis;

    service = new ConversationService(mockConvRepo, mockUserRepo, mockRealtimeService, mockRedis);
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

    it("returns existing conversation if one is already established", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(mockConvWithPartner);

      const result = await service.getOrCreateDirect(userA, userB);

      expect(result.id).toBe(convId);
      expect(result.partner?.id).toBe(userB);
      expect(result).not.toHaveProperty("directKey");
      expect(result).not.toHaveProperty("lastReadMessageId");
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("creates and returns a new conversation if none exists", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      findDirectByParticipantsMock.mockResolvedValue(null);
      createDirectConversationMock.mockResolvedValue(mockConvWithPartner);

      const result = await service.getOrCreateDirect(userA, userB);

      expect(result.id).toBe(convId);
      expect(result).not.toHaveProperty("directKey");
      expect(createDirectConversationMock).toHaveBeenCalledWith(userA, userB);
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
    });
  });

  describe("markAsRead", () => {
    it("updates last read, resets Redis counter, and emits realtime notification", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });

      await service.markAsRead(convId, userA, "msg-123");

      expect(updateLastReadMock).toHaveBeenCalledWith(convId, userA, "msg-123");
      expect(redisDelMock).toHaveBeenCalled();
      expect(emitReadUpdatedMock).toHaveBeenCalledWith(
        convId,
        expect.objectContaining({ userId: userA, lastReadMessageId: "msg-123" }),
      );
    });
  });
});
