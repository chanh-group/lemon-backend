import { beforeEach, describe, expect, it, vi } from "vitest";
import { FriendService } from "../../../../src/domain/friend/service.js";

describe("FriendService", () => {
  const userId = "0193a2b1-0000-7000-8000-000000000001";
  const otherId = "0193a2b1-0000-7000-8000-000000000002";
  let friendRepo: {
    findByPair: ReturnType<typeof vi.fn>;
    createRequest: ReturnType<typeof vi.fn>;
    acceptRequest: ReturnType<typeof vi.fn>;
    deleteIncomingRequest: ReturnType<typeof vi.fn>;
    deleteOutgoingRequest: ReturnType<typeof vi.fn>;
    deleteAcceptedPair: ReturnType<typeof vi.fn>;
    blockPair: ReturnType<typeof vi.fn>;
  };
  let userRepo: { findById: ReturnType<typeof vi.fn> };
  let cache: { invalidateFeedsBestEffort: ReturnType<typeof vi.fn> };
  let service: FriendService;

  beforeEach(() => {
    friendRepo = {
      findByPair: vi.fn().mockResolvedValue(null),
      createRequest: vi.fn().mockResolvedValue({
        friendship: { id: "request-id", requesterId: userId, status: "PENDING" },
        created: true,
      }),
      acceptRequest: vi.fn(),
      deleteIncomingRequest: vi.fn(),
      deleteOutgoingRequest: vi.fn(),
      deleteAcceptedPair: vi.fn(),
      blockPair: vi.fn(),
    };
    userRepo = {
      findById: vi.fn().mockImplementation(async (id: string) => ({
        id,
        fullName: id === userId ? "Requester" : "Recipient",
        username: id === userId ? "requester" : "recipient",
      })),
    };
    cache = { invalidateFeedsBestEffort: vi.fn().mockResolvedValue(undefined) };
    service = new FriendService(
      friendRepo as never,
      userRepo as never,
      { emitFriendRequestReceived: vi.fn() } as never,
      cache as never,
    );
  });

  it("persists a request only after verifying the recipient", async () => {
    await service.sendRequest(userId, otherId);

    expect(userRepo.findById).toHaveBeenCalledWith(otherId);
    expect(userRepo.findById).toHaveBeenCalledWith(userId);
    expect(friendRepo.createRequest).toHaveBeenCalledWith(userId, otherId);
  });

  it("emits a realtime notification only after creating a new request", async () => {
    const emitFriendRequestReceived = vi.fn();
    service = new FriendService(
      friendRepo as never,
      userRepo as never,
      { emitFriendRequestReceived } as never,
      cache as never,
    );

    await service.sendRequest(userId, otherId);

    expect(emitFriendRequestReceived).toHaveBeenCalledWith(otherId, {
      id: "request-id",
      user: { id: userId, name: "Requester", username: "requester" },
    });
  });

  it("does not emit a notification when a concurrent request already exists", async () => {
    const emitFriendRequestReceived = vi.fn();
    friendRepo.createRequest.mockResolvedValue({
      friendship: { id: "request-id", requesterId: userId, status: "PENDING" },
      created: false,
    });
    service = new FriendService(
      friendRepo as never,
      userRepo as never,
      { emitFriendRequestReceived } as never,
      cache as never,
    );

    await expect(service.sendRequest(userId, otherId)).rejects.toMatchObject({
      code: "FRIEND_REQUEST_EXISTS",
    });

    expect(emitFriendRequestReceived).not.toHaveBeenCalled();
  });

  it("rejects requests to blocked users", async () => {
    friendRepo.findByPair.mockResolvedValue({ status: "BLOCKED" });

    await expect(service.sendRequest(userId, otherId)).rejects.toMatchObject({
      code: "USER_BLOCKED",
    });
    expect(friendRepo.createRequest).not.toHaveBeenCalled();
  });

  it("rejects requests when a request is already pending", async () => {
    friendRepo.findByPair.mockResolvedValue({ status: "PENDING" });

    await expect(service.sendRequest(userId, otherId)).rejects.toMatchObject({
      code: "FRIEND_REQUEST_EXISTS",
    });
    expect(friendRepo.createRequest).not.toHaveBeenCalled();
  });

  it("does not allow chat until friendship is accepted", async () => {
    friendRepo.findByPair.mockResolvedValue({ status: "PENDING" });

    await expect(service.assertCanChat(userId, otherId)).rejects.toMatchObject({
      code: "FRIENDSHIP_REQUIRED",
    });
  });

  it("rejects chat immediately when either user is blocked", async () => {
    friendRepo.findByPair.mockResolvedValue({ status: "BLOCKED" });

    await expect(service.assertCanChat(userId, otherId)).rejects.toMatchObject({
      code: "USER_BLOCKED",
    });
  });

  it("allows chat only for an accepted friendship", async () => {
    friendRepo.findByPair.mockResolvedValue({ status: "ACCEPTED" });

    await expect(service.assertCanChat(userId, otherId)).resolves.toBeUndefined();
  });

  it("returns the conversation created atomically with an accepted request", async () => {
    const conversation = {
      id: "conversation-id",
      kind: "DIRECT",
      unreadCount: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const joinConversation = vi.fn();
    const emitFriendRequestAccepted = vi.fn();
    friendRepo.acceptRequest.mockResolvedValue({
      id: "request-id",
      requesterId: userId,
      addresseeId: otherId,
      conversation,
    });
    service = new FriendService(
      friendRepo as never,
      userRepo as never,
      { emitFriendRequestReceived: vi.fn(), joinConversation, emitFriendRequestAccepted } as never,
      cache as never,
    );

    await expect(service.acceptRequest("request-id", otherId)).resolves.toBe(conversation);
    expect(joinConversation).toHaveBeenCalledWith([userId, otherId], conversation.id);
    expect(emitFriendRequestAccepted).toHaveBeenCalledWith(userId, {
      requestId: "request-id",
      addresseeId: otherId,
    });
    expect(cache.invalidateFeedsBestEffort).toHaveBeenCalled();
  });

  it("does not create a conversation when there is no pending request to accept", async () => {
    friendRepo.acceptRequest.mockResolvedValue(null);

    await expect(service.acceptRequest("missing-request", otherId)).rejects.toMatchObject({
      code: "FRIEND_REQUEST_NOT_FOUND",
    });
    expect(cache.invalidateFeedsBestEffort).not.toHaveBeenCalled();
  });

  it("records a block even when no friendship row exists yet", async () => {
    await service.blockUser(userId, otherId);

    expect(friendRepo.blockPair).toHaveBeenCalledWith(userId, otherId);
  });

  describe("removeFriend", () => {
    it("rejects removing oneself", async () => {
      await expect(service.removeFriend(userId, userId)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("rejects when no accepted pair exists", async () => {
      friendRepo.deleteAcceptedPair.mockResolvedValue(false);

      await expect(service.removeFriend(userId, otherId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("deletes accepted pair, invalidates cache feeds and emits friend:removed", async () => {
      const emitFriendRemoved = vi.fn();
      friendRepo.deleteAcceptedPair.mockResolvedValue(true);
      service = new FriendService(
        friendRepo as never,
        userRepo as never,
        { emitFriendRequestReceived: vi.fn(), emitFriendRemoved } as never,
        cache as never,
      );

      await service.removeFriend(userId, otherId);

      expect(friendRepo.deleteAcceptedPair).toHaveBeenCalledWith(userId, otherId);
      expect(cache.invalidateFeedsBestEffort).toHaveBeenCalled();
      expect(emitFriendRemoved).toHaveBeenCalledWith(userId, otherId);
    });
  });

  describe("declineRequest", () => {
    it("throws FRIEND_REQUEST_NOT_FOUND when incoming request does not exist", async () => {
      friendRepo.deleteIncomingRequest.mockResolvedValue(null);

      await expect(service.declineRequest("missing-request", userId)).rejects.toMatchObject({
        code: "FRIEND_REQUEST_NOT_FOUND",
      });
    });

    it("deletes incoming request and emits friend:request:declined to the requester", async () => {
      const emitFriendRequestDeclined = vi.fn();
      friendRepo.deleteIncomingRequest.mockResolvedValue({
        id: "request-id",
        requesterId: otherId,
      });
      service = new FriendService(
        friendRepo as never,
        userRepo as never,
        { emitFriendRequestReceived: vi.fn(), emitFriendRequestDeclined } as never,
        cache as never,
      );

      await service.declineRequest("request-id", userId);

      expect(friendRepo.deleteIncomingRequest).toHaveBeenCalledWith("request-id", userId);
      expect(emitFriendRequestDeclined).toHaveBeenCalledWith(otherId, {
        requestId: "request-id",
        addresseeId: userId,
      });
    });
  });

  describe("cancelRequest", () => {
    it("throws FRIEND_REQUEST_NOT_FOUND when outgoing request does not exist", async () => {
      friendRepo.deleteOutgoingRequest.mockResolvedValue(null);

      await expect(service.cancelRequest("missing-request", userId)).rejects.toMatchObject({
        code: "FRIEND_REQUEST_NOT_FOUND",
      });
    });

    it("deletes outgoing request and emits friend:request:cancelled to the recipient", async () => {
      const emitFriendRequestCancelled = vi.fn();
      friendRepo.deleteOutgoingRequest.mockResolvedValue({
        id: "request-id",
        addresseeId: otherId,
      });
      service = new FriendService(
        friendRepo as never,
        userRepo as never,
        { emitFriendRequestReceived: vi.fn(), emitFriendRequestCancelled } as never,
        cache as never,
      );

      await service.cancelRequest("request-id", userId);

      expect(friendRepo.deleteOutgoingRequest).toHaveBeenCalledWith("request-id", userId);
      expect(emitFriendRequestCancelled).toHaveBeenCalledWith(otherId, {
        requestId: "request-id",
        requesterId: userId,
      });
    });
  });
});
