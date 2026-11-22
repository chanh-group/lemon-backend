import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Logger } from "@nestjs/common";
import { ConversationService } from "../../../../src/domain/conversation/service.js";
import type {
  ConversationRepository,
  ConversationWithPartner,
} from "../../../../src/domain/conversation/repository.js";
import type { UserRepository } from "../../../../src/domain/user/repository.js";
import type { RealtimeService } from "../../../../src/domain/realtime/service.js";
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
  let canAccessMessageMock: Mock;
  let updateLastReadMock: Mock;
  let countUnreadMock: Mock;
  let countUnreadBatchMock: Mock;
  let createGroupMock: Mock;
  let findGroupCreateRequestMock: Mock;
  let updateGroupAvatarMock: Mock;
  let updateGroupTitleMock: Mock;
  let disbandGroupMock: Mock;
  let leaveConversationMock: Mock;
  let findAcceptedFriendIdsMock: Mock;
  let getParticipantUserIdsMock: Mock;
  let getMessageRecipientUserIdsMock: Mock;
  let emitGroupEventMock: Mock;

  let findUserByIdMock: Mock;
  let findUsersByIdsMock: Mock;
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
    unreadRevision: "1",
    lastReadMessageId: null,
  };

  beforeEach(() => {
    findDirectByParticipantsMock = vi.fn();
    createDirectConversationMock = vi.fn();
    findUserConversationsMock = vi.fn();
    existsByIdMock = vi.fn();
    findByIdMock = vi.fn();
    isMessageInConversationMock = vi.fn().mockResolvedValue(true);
    canAccessMessageMock = vi.fn().mockResolvedValue(true);
    updateLastReadMock = vi.fn();
    countUnreadMock = vi.fn();
    countUnreadBatchMock = vi.fn().mockResolvedValue(new Map());
    createGroupMock = vi.fn();
    findGroupCreateRequestMock = vi.fn().mockResolvedValue(null);
    updateGroupAvatarMock = vi.fn().mockResolvedValue(undefined);
    updateGroupTitleMock = vi.fn().mockResolvedValue(undefined);
    disbandGroupMock = vi.fn().mockResolvedValue([userA, userB]);
    leaveConversationMock = vi.fn();
    findAcceptedFriendIdsMock = vi.fn().mockResolvedValue(new Set([userB]));
    getParticipantUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    getMessageRecipientUserIdsMock = vi.fn().mockResolvedValue([userA, userB]);
    emitGroupEventMock = vi.fn();

    findUserByIdMock = vi.fn();
    findUsersByIdsMock = vi.fn();
    assertCanChatMock = vi.fn().mockResolvedValue(undefined);
    emitReadUpdatedMock = vi.fn();
    joinConversationMock = vi.fn();

    const mockConvRepo = {
      findDirectByParticipants: findDirectByParticipantsMock,
      createGroup: createGroupMock,
      findGroupCreateRequest: findGroupCreateRequestMock,
      updateGroupAvatar: updateGroupAvatarMock,
      updateGroup: updateGroupTitleMock,
      disbandGroup: disbandGroupMock,
      getParticipantUserIds: getParticipantUserIdsMock,
      getMessageRecipientUserIds: getMessageRecipientUserIdsMock,
      createDirectConversation: createDirectConversationMock,
      findUserConversations: findUserConversationsMock,
      existsById: existsByIdMock,
      findById: findByIdMock,
      isMessageInConversation: isMessageInConversationMock,
      canAccessMessage: canAccessMessageMock,
      updateLastRead: updateLastReadMock,
      countUnread: countUnreadMock,
      countUnreadByConversationIds: countUnreadBatchMock,
    } as unknown as ConversationRepository;

    const mockUserRepo = {
      findById: findUserByIdMock,
      findByIds: findUsersByIdsMock,
    } as unknown as UserRepository;

    const mockRealtimeService = {
      emitReadUpdated: emitReadUpdatedMock,
      joinConversation: joinConversationMock,
      leaveConversation: leaveConversationMock,
      emitGroupEvent: emitGroupEventMock,
    } as unknown as RealtimeService;
    const mockFriendService = {
      assertCanChat: assertCanChatMock,
      findAcceptedFriendIds: findAcceptedFriendIdsMock,
    } as unknown as FriendService;

    redisPipelineExecMock = vi
      .fn()
      .mockResolvedValue([
        [null, JSON.stringify({ revision: "1", lastRead: null, count: 3 })],
        presenceOnline,
      ] satisfies [Error | null, unknown][]);
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

  describe("updateGroupAvatar", () => {
    const avatarUrl = "https://api.example.com/api/files/group-avatars/photo.png";

    it("allows a group admin to attach an avatar and notifies members", async () => {
      findByIdMock.mockResolvedValue({ id: convId, kind: "GROUP", myRole: "ADMIN" });
      await expect(service.updateGroupAvatar(convId, userA, avatarUrl)).resolves.toBeUndefined();
      expect(updateGroupAvatarMock).toHaveBeenCalledWith(convId, userA, avatarUrl);
      expect(emitGroupEventMock).toHaveBeenCalledWith([userA, userB], "conversation:updated", {
        conversationId: convId,
      });
    });

    it("keeps the committed avatar when the notification lookup fails", async () => {
      findByIdMock.mockResolvedValue({ id: convId, kind: "GROUP", myRole: "ADMIN" });
      getParticipantUserIdsMock.mockRejectedValueOnce(
        new Error("database temporarily unavailable"),
      );

      await expect(service.updateGroupAvatar(convId, userA, avatarUrl)).resolves.toBeUndefined();
      expect(updateGroupAvatarMock).toHaveBeenCalledWith(convId, userA, avatarUrl);
    });

    it("rejects a regular member attempting to update the group photo", async () => {
      findByIdMock.mockResolvedValue({ id: convId, kind: "GROUP", myRole: "MEMBER" });

      await expect(service.updateGroupAvatar(convId, userA, avatarUrl)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(updateGroupAvatarMock).not.toHaveBeenCalled();
    });

    it("rejects a user who is no longer in the group", async () => {
      findByIdMock.mockResolvedValue(null);
      await expect(service.updateGroupAvatar(convId, userA, avatarUrl)).rejects.toMatchObject({
        code: "NOT_PARTICIPANT",
      });
      expect(updateGroupAvatarMock).not.toHaveBeenCalled();
    });
  });

  it("rejects a regular member attempting to rename the group", async () => {
    findByIdMock.mockResolvedValue({ id: convId, kind: "GROUP", myRole: "MEMBER" });

    await expect(service.updateGroupTitle(convId, userA, "New title")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateGroupTitleMock).not.toHaveBeenCalled();
  });

  it("lets an admin rename the group", async () => {
    findByIdMock.mockResolvedValue({ id: convId, kind: "GROUP", myRole: "ADMIN" });

    await service.updateGroupTitle(convId, userA, "New title");

    expect(updateGroupTitleMock).toHaveBeenCalledWith(convId, userA, "New title");
    expect(emitGroupEventMock).toHaveBeenCalledWith([userA, userB], "conversation:updated", {
      conversationId: convId,
    });
  });

  it("notifies everyone and removes socket access when an admin disbands a group", async () => {
    await service.disbandGroup(convId, userA);

    expect(disbandGroupMock).toHaveBeenCalledWith(convId, userA);
    expect(leaveConversationMock).toHaveBeenCalledWith([userA, userB], convId);
    expect(emitGroupEventMock).toHaveBeenCalledWith([userA, userB], "conversation:disbanded", {
      conversationId: convId,
    });
  });

  describe("createGroup", () => {
    it("requires at least two invited friends", async () => {
      await expect(
        service.createGroup(userA, {
          title: "Project",
          memberIds: [userB],
          clientRequestId: "0193a2b1-0000-7000-8000-000000000030",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
      expect(createGroupMock).not.toHaveBeenCalled();
    });

    it("creates a group only with active friends and joins their realtime room", async () => {
      const userC = "0193a2b1-0000-7000-8000-000000000003";
      findUserByIdMock.mockResolvedValue({ isActive: true });
      findUsersByIdsMock.mockResolvedValue([{ isActive: true }, { isActive: true }]);
      findAcceptedFriendIdsMock.mockResolvedValue(new Set([userB, userC]));
      const group: ConversationWithPartner = {
        ...mockConvWithPartner,
        kind: "GROUP",
        directKey: null,
        title: "Project",
        memberCount: 3,
        myRole: "ADMIN",
        partner: undefined,
      };
      createGroupMock.mockResolvedValue({ conversation: group, created: true });

      const response = await service.createGroup(userA, {
        title: " Project ",
        memberIds: [userB, userC],
        clientRequestId: "0193a2b1-0000-7000-8000-000000000030",
      });

      expect(createGroupMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Project", creatorId: userA }),
      );
      expect(joinConversationMock).not.toHaveBeenCalled();
      expect(emitGroupEventMock).toHaveBeenCalledWith(
        [userA, userB],
        "conversation:created",
        expect.objectContaining({ conversationId: group.id }),
      );
      expect(response.kind).toBe("GROUP");
    });
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
      const friendshipError = new BusinessError("FRIENDSHIP_REQUIRED");
      assertCanChatMock.mockRejectedValue(friendshipError);

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toBe(friendshipError);
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("runs the target lookup, friendship check and conversation lookup concurrently", async () => {
      findUserByIdMock.mockResolvedValue(null);

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toThrow(
        expect.objectContaining({ code: "USER_NOT_FOUND" }),
      );
      expect(assertCanChatMock).toHaveBeenCalledWith(userA, userB);
      expect(findDirectByParticipantsMock).toHaveBeenCalledWith(userA, userB);
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("surfaces USER_NOT_FOUND before a friendship failure when both checks fail", async () => {
      findUserByIdMock.mockResolvedValue(null);
      assertCanChatMock.mockRejectedValue(new BusinessError("FRIENDSHIP_REQUIRED"));

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toThrow(
        expect.objectContaining({ code: "USER_NOT_FOUND" }),
      );
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("surfaces the friendship error before a conversation lookup failure", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      const friendshipError = new BusinessError("FRIENDSHIP_REQUIRED");
      assertCanChatMock.mockRejectedValue(friendshipError);
      findDirectByParticipantsMock.mockRejectedValue(new Error("db down"));

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toBe(friendshipError);
      expect(createDirectConversationMock).not.toHaveBeenCalled();
    });

    it("rethrows the conversation lookup failure unchanged when the earlier checks pass", async () => {
      findUserByIdMock.mockResolvedValue({ id: userB });
      const lookupError = new Error("db down");
      findDirectByParticipantsMock.mockRejectedValue(lookupError);

      await expect(service.getOrCreateDirect(userA, userB)).rejects.toBe(lookupError);
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
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });

      const result = await service.listConversations(userA, 20);

      expect(findUserConversationsMock).toHaveBeenCalledWith(userA, 20, undefined);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(convId);
      expect(result.items[0].partner?.isOnline).toBe(true);
      expect(result.items[0]).not.toHaveProperty("directKey");
      expect(result.items[0]).not.toHaveProperty("lastReadMessageId");
    });

    it("maps unreadCount and presence enriched from Redis", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });

      const result = await service.listConversations(userA);

      expect(result.items[0].unreadCount).toBe(3);
      expect(result.items[0].partner?.isOnline).toBe(true);
      expect(countUnreadMock).not.toHaveBeenCalled();
      expect(redisSetMock).not.toHaveBeenCalled();
    });

    it("rebuilds unreadCount from the database and caches it when Redis has no value", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, "OK"]]);
      countUnreadBatchMock.mockResolvedValue(new Map([[convId, 3]]));

      const result = await service.listConversations(userA);

      expect(countUnreadBatchMock).toHaveBeenCalledWith([convId], userA);
      expect(result.items[0].unreadCount).toBe(3);
      expect(redisPipelineSetMock).toHaveBeenCalledWith(
        unreadCountKey(userA, convId),
        JSON.stringify({ revision: "1", lastRead: null, count: 3 }),
        "EX",
        86400,
      );
    });

    it("fails when Redis returns a pipeline command error instead of treating it as a cache miss", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });
      redisPipelineExecMock.mockResolvedValue([[new Error("READONLY"), null], presenceOnline]);

      await expect(service.listConversations(userA)).rejects.toMatchObject({ kind: "unavailable" });

      expect(countUnreadBatchMock).not.toHaveBeenCalled();
    });

    it("rebuilds all missing counters in one batch across conversations", async () => {
      const otherConvId = "0193a2b1-0000-7000-8000-000000000011";
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }, { ...mockConvWithPartner, id: otherConvId }],
        hasMore: false,
      });
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
      expect(result.items[0].unreadCount).toBe(1);
      expect(result.items[1].unreadCount).toBe(1);
    });

    it("returns a server error when rebuilding unread counts fails", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });
      redisPipelineExecMock.mockResolvedValue([[null, null], presenceOnline]);
      countUnreadBatchMock.mockRejectedValue(new Error("db down"));
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      await expect(service.listConversations(userA)).rejects.toMatchObject({ kind: "database" });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("coalesces concurrent cache-miss rebuilds into a single database query", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, "OK"]])
        .mockResolvedValueOnce([[null, "OK"]]);
      let releaseRebuild!: (counts: Map<string, number>) => void;
      countUnreadBatchMock.mockImplementation(
        () =>
          new Promise<Map<string, number>>((resolve) => {
            releaseRebuild = resolve;
          }),
      );

      const first = service.listConversations(userA);
      const second = service.listConversations(userA);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(countUnreadBatchMock).toHaveBeenCalledOnce();

      releaseRebuild(new Map([[convId, 3]]));
      const [firstPage, secondPage] = await Promise.all([first, second]);

      expect(countUnreadBatchMock).toHaveBeenCalledOnce();
      expect(firstPage.items[0].unreadCount).toBe(3);
      expect(secondPage.items[0].unreadCount).toBe(3);
    });

    it("does not share a rebuild across unread revisions", async () => {
      findUserConversationsMock
        .mockResolvedValueOnce({ items: [{ ...mockConvWithPartner }], hasMore: false })
        .mockResolvedValueOnce({
          items: [{ ...mockConvWithPartner, unreadRevision: "2" }],
          hasMore: false,
        });
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValue([[null, "OK"]]);
      let releaseRebuild!: (counts: Map<string, number>) => void;
      countUnreadBatchMock
        .mockImplementationOnce(
          () =>
            new Promise<Map<string, number>>((resolve) => {
              releaseRebuild = resolve;
            }),
        )
        .mockResolvedValueOnce(new Map([[convId, 4]]));

      const first = service.listConversations(userA);
      await vi.waitFor(() => expect(countUnreadBatchMock).toHaveBeenCalledOnce());
      const second = service.listConversations(userA);
      await vi.waitFor(() => expect(countUnreadBatchMock).toHaveBeenCalledTimes(2));
      expect((await second).items[0].unreadCount).toBe(4);
      expect(redisPipelineSetMock).toHaveBeenCalledWith(
        unreadCountKey(userA, convId),
        JSON.stringify({ revision: "2", lastRead: null, count: 4 }),
        "EX",
        86400,
      );
      releaseRebuild(new Map([[convId, 3]]));
      expect((await first).items[0].unreadCount).toBe(3);
    });

    it("rejects every coalesced caller when the shared rebuild fails and retries afterwards", async () => {
      findUserConversationsMock.mockResolvedValue({
        items: [{ ...mockConvWithPartner }],
        hasMore: false,
      });
      redisPipelineExecMock
        .mockResolvedValueOnce([[null, null], presenceOnline])
        .mockResolvedValueOnce([[null, null], presenceOnline]);
      let failRebuild!: (err: Error) => void;
      countUnreadBatchMock.mockImplementation(
        () =>
          new Promise<Map<string, number>>((_, reject) => {
            failRebuild = reject;
          }),
      );
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      try {
        const first = service.listConversations(userA);
        const second = service.listConversations(userA);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        expect(countUnreadBatchMock).toHaveBeenCalledOnce();

        const firstRejection = expect(first).rejects.toMatchObject({ kind: "database" });
        const secondRejection = expect(second).rejects.toMatchObject({ kind: "database" });
        failRebuild(new Error("db down"));
        await Promise.all([firstRejection, secondRejection]);

        countUnreadBatchMock.mockResolvedValue(new Map([[convId, 3]]));
        redisPipelineExecMock
          .mockResolvedValueOnce([[null, null], presenceOnline])
          .mockResolvedValueOnce([[null, "OK"]]);
        const third = await service.listConversations(userA);

        expect(third.items[0].unreadCount).toBe(3);
        expect(countUnreadBatchMock).toHaveBeenCalledTimes(2);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("getById", () => {
    it("rebuilds a stale unread cache after the database revision changes", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner, unreadRevision: "2" });
      redisPipelineExecMock.mockResolvedValue([
        [null, JSON.stringify({ revision: "1", lastRead: null, count: 3 })],
        presenceOnline,
      ]);
      countUnreadMock.mockResolvedValue(4);

      const result = await service.getById(convId, userA);

      expect(result.unreadCount).toBe(4);
      expect(redisSetMock).toHaveBeenCalledWith(
        unreadCountKey(userA, convId),
        JSON.stringify({ revision: "2", lastRead: null, count: 4 }),
        "EX",
        86400,
      );
    });

    it("rebuilds an unread cache created before the read pointer advanced", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner, lastReadMessageId: "new-read" });
      countUnreadMock.mockResolvedValue(0);

      const result = await service.getById(convId, userA);

      expect(result.unreadCount).toBe(0);
      expect(countUnreadMock).toHaveBeenCalledOnce();
    });

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
      expect(redisSetMock).toHaveBeenCalledWith(
        unreadCountKey(userA, convId),
        JSON.stringify({ revision: "1", lastRead: null, count: 4 }),
        "EX",
        86400,
      );
    });

    it("fails when Redis returns a pipeline command error instead of treating it as a cache miss", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      redisPipelineExecMock.mockResolvedValue([[new Error("READONLY"), null], presenceOnline]);

      await expect(service.getById(convId, userA)).rejects.toMatchObject({ kind: "unavailable" });

      expect(countUnreadMock).not.toHaveBeenCalled();
    });

    it("returns a server error when rebuilding unread counts fails", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });
      redisPipelineExecMock.mockResolvedValue([[null, null], presenceOnline]);
      countUnreadMock.mockRejectedValue(new Error("db down"));
      const warn = vi.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

      await expect(service.getById(convId, userA)).rejects.toMatchObject({ kind: "database" });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("markAsRead", () => {
    it("updates last read and emits realtime notification without mutating the cache", async () => {
      existsByIdMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ ...mockConvWithPartner });

      await service.markAsRead(convId, userA, "msg-123");

      expect(isMessageInConversationMock).toHaveBeenCalledWith(convId, "msg-123");
      expect(updateLastReadMock).toHaveBeenCalledWith(convId, userA, "msg-123");
      expect(redisDelMock).not.toHaveBeenCalled();
      expect(redisPipelineMock).not.toHaveBeenCalled();
      expect(countUnreadMock).not.toHaveBeenCalled();
      expect(emitReadUpdatedMock).toHaveBeenCalledWith(
        convId,
        expect.objectContaining({ userId: userA, lastReadMessageId: "msg-123" }),
        undefined,
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
