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
  let cache: { deleteManyBestEffort: ReturnType<typeof vi.fn> };
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
    cache = { deleteManyBestEffort: vi.fn().mockResolvedValue(undefined) };
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

  it("records a block even when no friendship row exists yet", async () => {
    await service.blockUser(userId, otherId);

    expect(friendRepo.blockPair).toHaveBeenCalledWith(userId, otherId);
  });
});
