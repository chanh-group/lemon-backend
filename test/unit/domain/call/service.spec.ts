import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { CallService } from "../../../../src/domain/call/service.js";
import type { CallRepository } from "../../../../src/domain/call/repository.js";
import type {
  ConversationRepository,
  ConversationWithPartner,
} from "../../../../src/domain/conversation/repository.js";
import type { CacheStore } from "../../../../src/utils/cache/store.js";
import type { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { UserService } from "../../../../src/domain/user/service.js";
import type { CallWithUsers } from "../../../../src/domain/call/types.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

describe("CallService", () => {
  let service: CallService;

  let createCallMock: Mock;
  let findByIdMock: Mock;
  let findActiveCallForUserMock: Mock;
  let updateStatusMock: Mock;
  let findCallsByConversationMock: Mock;
  let findCallsByUserMock: Mock;

  let convFindByIdMock: Mock;
  let convExistsByIdMock: Mock;

  let cacheGetRawMock: Mock;
  let cacheSetRawMock: Mock;
  let cacheTryAcquireLockMock: Mock;
  let cacheReleaseLockMock: Mock;
  let cacheDeleteMock: Mock;

  let joinCallMock: Mock;
  let leaveCallMock: Mock;
  let emitCallIncomingMock: Mock;
  let emitCallAcceptedMock: Mock;
  let emitCallRejectedMock: Mock;
  let emitCallCancelledMock: Mock;
  let emitCallMissedMock: Mock;
  let emitCallEndedMock: Mock;
  let emitCallUserDisconnectedMock: Mock;
  let emitCallUserReconnectedMock: Mock;

  let userFindByIdMock: Mock;

  const callerId = "0193a2b1-0000-7000-8000-000000000001";
  const calleeId = "0193a2b1-0000-7000-8000-000000000002";
  const convId = "0193a2b1-0000-7000-8000-000000000010";
  const callId = "0193a2b1-0000-7000-8000-000000000020";

  const mockCall: CallWithUsers = {
    id: callId,
    conversationId: convId,
    callerId,
    calleeId,
    media: "VIDEO",
    status: "INITIATED",
    startedAt: new Date("2026-11-20T10:00:00Z"),
    answeredAt: null,
    endedAt: null,
    endReason: null,
    durationSecs: 0,
    caller: {
      id: callerId,
      username: "caller_user",
      fullName: "Caller User",
      avatarUrl: null,
    },
    callee: {
      id: calleeId,
      username: "callee_user",
      fullName: "Callee User",
      avatarUrl: null,
    },
  };

  const mockConv: ConversationWithPartner = {
    id: convId,
    kind: "DIRECT",
    directKey: `${callerId}:${calleeId}`,
    createdAt: new Date(),
    lastMessageAt: null,
    lastMessagePreview: null,
    partner: {
      id: calleeId,
      username: "callee_user",
      fullName: "Callee User",
      avatarUrl: null,
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();

    createCallMock = vi.fn().mockResolvedValue(mockCall);
    findByIdMock = vi.fn().mockResolvedValue(mockCall);
    findActiveCallForUserMock = vi.fn().mockResolvedValue(null);
    updateStatusMock = vi.fn().mockResolvedValue({
      ...mockCall,
      status: "ACCEPTED",
      answeredAt: new Date(),
    });
    findCallsByConversationMock = vi.fn().mockResolvedValue({ items: [mockCall], hasMore: false });
    findCallsByUserMock = vi.fn().mockResolvedValue({ items: [mockCall], hasMore: false });

    const callRepo = {
      createCall: createCallMock,
      findById: findByIdMock,
      findActiveCallForUser: findActiveCallForUserMock,
      updateStatus: updateStatusMock,
      findCallsByConversation: findCallsByConversationMock,
      findCallsByUser: findCallsByUserMock,
    } as unknown as CallRepository;

    convFindByIdMock = vi.fn().mockResolvedValue(mockConv);
    convExistsByIdMock = vi.fn().mockResolvedValue(true);

    const convRepo = {
      findById: convFindByIdMock,
      existsById: convExistsByIdMock,
    } as unknown as ConversationRepository;

    cacheGetRawMock = vi.fn().mockResolvedValue(null);
    cacheSetRawMock = vi.fn().mockResolvedValue(undefined);
    cacheTryAcquireLockMock = vi.fn().mockResolvedValue(true);
    cacheReleaseLockMock = vi.fn().mockResolvedValue(undefined);
    cacheDeleteMock = vi.fn().mockResolvedValue(undefined);

    const cache = {
      getRaw: cacheGetRawMock,
      setRaw: cacheSetRawMock,
      tryAcquireLock: cacheTryAcquireLockMock,
      releaseLock: cacheReleaseLockMock,
      delete: cacheDeleteMock,
    } as unknown as CacheStore;

    joinCallMock = vi.fn();
    leaveCallMock = vi.fn();
    emitCallIncomingMock = vi.fn();
    emitCallAcceptedMock = vi.fn();
    emitCallRejectedMock = vi.fn();
    emitCallCancelledMock = vi.fn();
    emitCallMissedMock = vi.fn();
    emitCallEndedMock = vi.fn();
    emitCallUserDisconnectedMock = vi.fn();
    emitCallUserReconnectedMock = vi.fn();

    const realtimeService = {
      joinCall: joinCallMock,
      leaveCall: leaveCallMock,
      emitCallIncoming: emitCallIncomingMock,
      emitCallAccepted: emitCallAcceptedMock,
      emitCallRejected: emitCallRejectedMock,
      emitCallCancelled: emitCallCancelledMock,
      emitCallMissed: emitCallMissedMock,
      emitCallEnded: emitCallEndedMock,
      emitCallUserDisconnected: emitCallUserDisconnectedMock,
      emitCallUserReconnected: emitCallUserReconnectedMock,
    } as unknown as RealtimeService;

    userFindByIdMock = vi.fn().mockResolvedValue({
      id: callerId,
      username: "caller_user",
      fullName: "Caller User",
      avatarUrl: null,
    });

    const userService = {
      findById: userFindByIdMock,
    } as unknown as UserService;

    service = new CallService(callRepo, convRepo, cache, realtimeService, userService);
  });

  afterEach(() => {
    service.onApplicationShutdown();
    vi.useRealTimers();
  });

  describe("LiveKit tokens & room lifecycle", () => {
    it("creates LiveKit token with serverUrl, room, and jwt token", async () => {
      const details = await service.createLiveKitToken(callerId, callId, "Caller User");

      expect(details.serverUrl).toBeDefined();
      expect(details.room).toBe(callId);
      expect(details.token).toBeDefined();
      expect(typeof details.token).toBe("string");
    });

    it("throws CALL_NOT_FOUND when getting token for nonexistent call", async () => {
      findByIdMock.mockResolvedValueOnce(null);

      await expect(service.getCallToken(callerId, callId)).rejects.toThrow(
        new BusinessError("CALL_NOT_FOUND"),
      );
    });

    it("throws CALL_UNAUTHORIZED_PARTICIPANT when non-participant gets token", async () => {
      await expect(
        service.getCallToken("0193a2b1-0000-7000-8000-999999999999", callId),
      ).rejects.toThrow(new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"));
    });

    it("throws CALL_INVALID_STATE when call has completed", async () => {
      findByIdMock.mockResolvedValueOnce({
        ...mockCall,
        status: "COMPLETED",
      });

      await expect(service.getCallToken(callerId, callId)).rejects.toThrow(
        new BusinessError("CALL_INVALID_STATE"),
      );
    });

    it("successfully returns LiveKit token for valid participant", async () => {
      const details = await service.getCallToken(callerId, callId);

      expect(details.serverUrl).toBeDefined();
      expect(details.room).toBe(callId);
      expect(details.token).toBeDefined();
    });

    it("handles deleteLiveKitRoom gracefully even on error", async () => {
      await expect(service.deleteLiveKitRoom(callId)).resolves.not.toThrow();
    });
  });

  describe("initiateCall", () => {
    it("throws CONVERSATION_NOT_FOUND when conversation does not exist", async () => {
      convFindByIdMock.mockResolvedValueOnce(null);
      convExistsByIdMock.mockResolvedValueOnce(false);

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("CONVERSATION_NOT_FOUND"));
    });

    it("throws NOT_PARTICIPANT when caller is not in conversation", async () => {
      convFindByIdMock.mockResolvedValueOnce(null);
      convExistsByIdMock.mockResolvedValueOnce(true);

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("NOT_PARTICIPANT"));
    });

    it("throws BAD_REQUEST when conversation is not DIRECT", async () => {
      convFindByIdMock.mockResolvedValueOnce({ ...mockConv, kind: "GROUP", partner: undefined });

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("BAD_REQUEST"));
    });

    it("throws CALL_CANNOT_CALL_SELF when caller is same as partner", async () => {
      convFindByIdMock.mockResolvedValueOnce({
        ...mockConv,
        partner: { id: callerId, username: "me", fullName: "Me", avatarUrl: null },
      });

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("CALL_CANNOT_CALL_SELF"));
    });

    it("throws CALL_USER_BUSY when caller lock cannot be acquired", async () => {
      cacheTryAcquireLockMock.mockResolvedValueOnce(false);

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("CALL_USER_BUSY"));
    });

    it("throws CALL_USER_BUSY and releases caller lock when callee is busy", async () => {
      cacheTryAcquireLockMock
        .mockResolvedValueOnce(true) // caller locked
        .mockResolvedValueOnce(false); // callee busy

      await expect(
        service.initiateCall(callerId, { conversationId: convId, media: "VIDEO" }),
      ).rejects.toThrow(new BusinessError("CALL_USER_BUSY"));

      expect(cacheReleaseLockMock).toHaveBeenCalled();
    });

    it("successfully initiates call and emits call:incoming with late-offer flow", async () => {
      const result = await service.initiateCall(callerId, {
        conversationId: convId,
        media: "VIDEO",
      });

      expect(createCallMock).toHaveBeenCalledWith({
        conversationId: convId,
        callerId,
        calleeId,
        media: "VIDEO",
      });
      expect(joinCallMock).toHaveBeenCalledWith([callerId, calleeId], callId);
      expect(emitCallIncomingMock).toHaveBeenCalledWith(
        calleeId,
        expect.objectContaining({
          callId,
          conversationId: convId,
          media: "VIDEO",
        }),
      );
      expect(result.id).toBe(callId);
      expect(result.livekit).toBeDefined();
      expect(result.livekit.room).toBe(callId);
    });
  });

  describe("acceptCall", () => {
    it("throws CALL_NOT_FOUND when call does not exist", async () => {
      findByIdMock.mockResolvedValueOnce(null);

      await expect(service.acceptCall(calleeId, callId)).rejects.toThrow(
        new BusinessError("CALL_NOT_FOUND"),
      );
    });

    it("throws CALL_UNAUTHORIZED_PARTICIPANT when caller attempts to accept", async () => {
      await expect(service.acceptCall(callerId, callId)).rejects.toThrow(
        new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"),
      );
    });

    it("throws CALL_INVALID_STATE when atomic update fails", async () => {
      updateStatusMock.mockResolvedValueOnce(null);

      await expect(service.acceptCall(calleeId, callId)).rejects.toThrow(
        new BusinessError("CALL_INVALID_STATE"),
      );
    });

    it("successfully accepts call, emits call:accepted, and returns ice servers", async () => {
      const result = await service.acceptCall(calleeId, callId);

      expect(updateStatusMock).toHaveBeenCalledWith(
        callId,
        ["INITIATED", "RINGING"],
        expect.objectContaining({ status: "ACCEPTED" }),
      );
      expect(emitCallAcceptedMock).toHaveBeenCalledWith(
        callId,
        expect.objectContaining({
          callId,
          acceptedBy: calleeId,
        }),
      );
      expect(result.status).toBe("ACCEPTED");
      expect(result.livekit).toBeDefined();
      expect(result.livekit.room).toBe(callId);
    });
  });

  describe("rejectCall", () => {
    it("throws CALL_UNAUTHORIZED_PARTICIPANT when caller tries to reject", async () => {
      await expect(service.rejectCall(callerId, callId)).rejects.toThrow(
        new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"),
      );
    });

    it("successfully rejects call, releases active locks, and emits call:rejected", async () => {
      updateStatusMock.mockResolvedValueOnce({
        ...mockCall,
        status: "REJECTED",
        endedAt: new Date(),
        endReason: "BUSY",
      });

      const result = await service.rejectCall(calleeId, callId, "BUSY");

      expect(cacheDeleteMock).toHaveBeenCalledTimes(2);
      expect(emitCallRejectedMock).toHaveBeenCalledWith(
        callerId,
        expect.objectContaining({
          callId,
          rejectedBy: calleeId,
          reason: "BUSY",
        }),
      );
      expect(leaveCallMock).toHaveBeenCalledWith([callerId, calleeId], callId);
      expect(result.status).toBe("REJECTED");
    });
  });

  describe("cancelCall", () => {
    it("throws CALL_UNAUTHORIZED_PARTICIPANT when callee tries to cancel", async () => {
      await expect(service.cancelCall(calleeId, callId)).rejects.toThrow(
        new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"),
      );
    });

    it("successfully cancels call, releases locks, and emits call:cancelled", async () => {
      updateStatusMock.mockResolvedValueOnce({
        ...mockCall,
        status: "CANCELLED",
        endedAt: new Date(),
        endReason: "CANCELLED",
      });

      const result = await service.cancelCall(callerId, callId);

      expect(cacheDeleteMock).toHaveBeenCalledTimes(2);
      expect(emitCallCancelledMock).toHaveBeenCalledWith(
        calleeId,
        expect.objectContaining({
          callId,
          cancelledBy: callerId,
        }),
      );
      expect(leaveCallMock).toHaveBeenCalledWith([callerId, calleeId], callId);
      expect(result.status).toBe("CANCELLED");
    });
  });

  describe("endCall", () => {
    it("throws CALL_UNAUTHORIZED_PARTICIPANT when stranger tries to end call", async () => {
      await expect(service.endCall("stranger-id", callId)).rejects.toThrow(
        new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"),
      );
    });

    it("successfully ends call from caller or callee, emitting call:ended", async () => {
      updateStatusMock.mockResolvedValueOnce({
        ...mockCall,
        status: "COMPLETED",
        endedAt: new Date(),
        endReason: "NORMAL",
        durationSecs: 42,
      });

      const result = await service.endCall(callerId, callId, "NORMAL");

      expect(cacheDeleteMock).toHaveBeenCalledTimes(2);
      expect(emitCallEndedMock).toHaveBeenCalledWith(
        callId,
        callerId,
        calleeId,
        expect.objectContaining({
          callId,
          endedBy: callerId,
          reason: "NORMAL",
          durationSecs: 42,
        }),
      );
      expect(leaveCallMock).toHaveBeenCalledWith([callerId, calleeId], callId);
      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("handleRingingTimeout (45s missed call)", () => {
    it("marks call as MISSED with MISSED_TIMEOUT, releases locks, and notifies both parties", async () => {
      updateStatusMock.mockResolvedValueOnce({
        ...mockCall,
        status: "MISSED",
        endedAt: new Date(),
        endReason: "MISSED_TIMEOUT",
        durationSecs: 0,
      });

      await service.handleRingingTimeout(callId);

      expect(updateStatusMock).toHaveBeenCalledWith(
        callId,
        ["INITIATED", "RINGING"],
        expect.objectContaining({
          status: "MISSED",
          endReason: "MISSED_TIMEOUT",
        }),
      );
      expect(cacheDeleteMock).toHaveBeenCalledTimes(2);
      expect(emitCallEndedMock).toHaveBeenCalledWith(
        callId,
        callerId,
        calleeId,
        expect.objectContaining({ reason: "MISSED_TIMEOUT" }),
      );
      expect(emitCallMissedMock).toHaveBeenCalledWith(
        calleeId,
        expect.objectContaining({
          callId,
          callerId,
          reason: "MISSED_TIMEOUT",
        }),
      );
    });

    it("does nothing if call status was already updated before timeout fired", async () => {
      updateStatusMock.mockResolvedValueOnce(null);

      await service.handleRingingTimeout(callId);

      expect(emitCallEndedMock).not.toHaveBeenCalled();
      expect(emitCallMissedMock).not.toHaveBeenCalled();
    });
  });

  describe("handleUserDisconnect and handleUserReconnect", () => {
    it("emits call:user-disconnected and starts grace timer", async () => {
      findActiveCallForUserMock.mockResolvedValueOnce({
        ...mockCall,
        status: "ACCEPTED",
      });

      await service.handleUserDisconnect(callerId);

      expect(emitCallUserDisconnectedMock).toHaveBeenCalledWith(callId, {
        callId,
        userId: callerId,
      });
    });

    it("cancels disconnect grace timer and emits call:user-reconnected on reconnect", async () => {
      findActiveCallForUserMock.mockResolvedValue({
        ...mockCall,
        status: "ACCEPTED",
      });

      await service.handleUserDisconnect(callerId);
      await service.handleUserReconnect(callerId);

      expect(emitCallUserReconnectedMock).toHaveBeenCalledWith(callId, {
        callId,
        userId: callerId,
      });
    });
  });

  describe("getActiveCall and getCallById", () => {
    it("returns active call when user is in active call", async () => {
      findActiveCallForUserMock.mockResolvedValueOnce(mockCall);

      const active = await service.getActiveCall(callerId);
      expect(active?.id).toBe(callId);
    });

    it("getCallById returns call for participant", async () => {
      const call = await service.getCallById(callerId, callId);
      expect(call.id).toBe(callId);
    });

    it("getCallById throws CALL_UNAUTHORIZED_PARTICIPANT for non-participant", async () => {
      await expect(service.getCallById("stranger", callId)).rejects.toThrow(
        new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT"),
      );
    });
  });

  describe("listCalls", () => {
    it("lists calls by conversation", async () => {
      const page = await service.listCalls(callerId, { conversationId: convId, limit: 10 });
      expect(page.items).toHaveLength(1);
      expect(findCallsByConversationMock).toHaveBeenCalledWith(convId, 10, undefined);
    });

    it("lists calls by user when conversationId is not provided", async () => {
      const page = await service.listCalls(callerId, { limit: 10 });
      expect(page.items).toHaveLength(1);
      expect(findCallsByUserMock).toHaveBeenCalledWith(callerId, 10, undefined);
    });
  });
});
