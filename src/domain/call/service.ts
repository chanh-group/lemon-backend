import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { v7 as uuidv7 } from "uuid";
import { get_env } from "../../helpers/index.js";
import { activeCallUserKey } from "../../utils/cache/keys.js";
import { CACHE_STORE, type CacheStore } from "../../utils/cache/store.js";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/service.js";
import { UserService } from "../user/service.js";
import type { CursorPage } from "../shared.js";
import {
  CALL_ACTIVE_LOCK_TTL_SECONDS,
  CALL_DISCONNECT_GRACE_MS,
  CALL_RING_DISCONNECT_GRACE_MS,
  CALL_RING_LOCK_TTL_SECONDS,
  CALL_RING_TIMEOUT_MS,
  DEFAULT_CALL_PAGE_SIZE,
  LIVEKIT_TOKEN_TTL_SECONDS,
} from "./constants.js";
import type { InitiateCallDto } from "./dto/request.js";
import type { AcceptCallResponse, CallResponse, InitiateCallResponse } from "./dto/response.js";
import { toCallResponse } from "./dto/mapper.js";
import { CALL_REPOSITORY, type CallRepository } from "./repository.js";
import type { LiveKitConnectionDetails } from "./types.js";

@Injectable()
export class CallService implements OnApplicationShutdown, OnApplicationBootstrap {
  private readonly logger = new Logger(CallService.name);
  private readonly ringingTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(CALL_REPOSITORY)
    private readonly callRepo: CallRepository,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepository,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    private readonly realtimeService: RealtimeService,
    @Optional()
    private readonly userService?: UserService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const staleCalls = await this.callRepo.cleanupStaleCalls();
      if (staleCalls.length > 0) {
        this.logger.log(`Cleaned up ${staleCalls.length} stale ringing call(s) on bootstrap`);
        await Promise.allSettled(
          staleCalls.flatMap((call) => [
            this.cache.releaseLock(activeCallUserKey(call.callerId), call.id),
            this.cache.releaseLock(activeCallUserKey(call.calleeId), call.id),
          ]),
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to cleanup stale ringing calls on bootstrap: ${String(err)}`);
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.ringingTimers.values()) {
      clearTimeout(timer);
    }
    this.ringingTimers.clear();

    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
  }

  private get livekitUrl(): string {
    return get_env("LIVEKIT_URL", "ws://localhost:7880");
  }

  private get livekitApiKey(): string {
    return get_env("LIVEKIT_API_KEY", "devkey");
  }

  private get livekitApiSecret(): string {
    return get_env("LIVEKIT_API_SECRET", "secret");
  }

  async createLiveKitToken(
    userId: string,
    callId: string,
    userName?: string,
  ): Promise<LiveKitConnectionDetails> {
    const at = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
      identity: userId,
      name: userName || userId,
      ttl: LIVEKIT_TOKEN_TTL_SECONDS,
    });

    at.addGrant({
      roomJoin: true,
      room: callId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return {
      serverUrl: this.livekitUrl,
      room: callId,
      token,
    };
  }

  async getCallToken(userId: string, callId: string): Promise<LiveKitConnectionDetails> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }
    if (
      call.status === "COMPLETED" ||
      call.status === "REJECTED" ||
      call.status === "CANCELLED" ||
      call.status === "MISSED" ||
      call.status === "FAILED"
    ) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    let userName = userId;
    if (this.userService) {
      const user = await this.userService.findById(userId);
      if (user?.fullName) userName = user.fullName;
      else if (user?.username) userName = user.username;
    }

    return this.createLiveKitToken(userId, callId, userName);
  }

  async deleteLiveKitRoom(callId: string): Promise<void> {
    try {
      const roomService = new RoomServiceClient(
        this.livekitUrl,
        this.livekitApiKey,
        this.livekitApiSecret,
      );
      await roomService.deleteRoom(callId);
    } catch (err) {
      this.logger.warn(`Failed to delete LiveKit room ${callId}: ${String(err)}`);
    }
  }

  async initiateCall(callerId: string, dto: InitiateCallDto): Promise<InitiateCallResponse> {
    const conversation = await this.convRepo.findById(dto.conversationId, callerId);
    if (!conversation) {
      const exists = await this.convRepo.existsById(dto.conversationId);
      if (!exists) throw new BusinessError("CONVERSATION_NOT_FOUND");
      throw new BusinessError("NOT_PARTICIPANT");
    }

    if (conversation.kind !== "DIRECT" || !conversation.partner) {
      throw new BusinessError("BAD_REQUEST");
    }

    const calleeId = conversation.partner.id;
    if (callerId === calleeId) {
      throw new BusinessError("CALL_CANNOT_CALL_SELF");
    }

    const callId = uuidv7();

    const callerLockKey = activeCallUserKey(callerId);
    const callerLocked = await this.cache.tryAcquireLock(
      callerLockKey,
      callId,
      CALL_RING_LOCK_TTL_SECONDS,
    );
    if (!callerLocked) {
      throw new BusinessError("CALL_USER_BUSY");
    }

    const calleeLockKey = activeCallUserKey(calleeId);
    const calleeLocked = await this.cache.tryAcquireLock(
      calleeLockKey,
      callId,
      CALL_RING_LOCK_TTL_SECONDS,
    );
    if (!calleeLocked) {
      await this.cache.releaseLock(callerLockKey, callId).catch(() => {});
      throw new BusinessError("CALL_USER_BUSY");
    }

    // Check DB ground truth for active calls for both participants
    const [callerActiveCall, calleeActiveCall] = await Promise.all([
      this.callRepo.findActiveCallForUser(callerId),
      this.callRepo.findActiveCallForUser(calleeId),
    ]);

    if (callerActiveCall || calleeActiveCall) {
      await Promise.allSettled([
        this.cache.releaseLock(callerLockKey, callId),
        this.cache.releaseLock(calleeLockKey, callId),
      ]);
      throw new BusinessError("CALL_USER_BUSY");
    }

    let call;
    try {
      call = await this.callRepo.createCall({
        id: callId,
        conversationId: dto.conversationId,
        callerId,
        calleeId,
        media: dto.media,
        status: "RINGING",
      });
    } catch (err) {
      await Promise.allSettled([
        this.cache.releaseLock(callerLockKey, callId),
        this.cache.releaseLock(calleeLockKey, callId),
      ]);
      throw err;
    }

    // Start 45s ringing timer for missed call
    const ringTimer = setTimeout(async () => {
      await this.handleRingingTimeout(callId);
    }, CALL_RING_TIMEOUT_MS);
    ringTimer.unref();
    this.ringingTimers.set(callId, ringTimer);

    // Ensure sockets are in the call room
    this.realtimeService.joinCall([callerId, calleeId], callId);

    // Resolve caller summary for incoming modal
    let callerSummary = call.caller;
    if (!callerSummary && this.userService) {
      const user = await this.userService.findById(callerId);
      if (user) {
        callerSummary = {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
        };
      }
    }

    this.realtimeService.emitCallIncoming(calleeId, {
      callId,
      conversationId: dto.conversationId,
      caller: callerSummary ?? {
        id: callerId,
        username: "",
        fullName: "",
        avatarUrl: null,
      },
      media: dto.media,
    });

    const livekit = await this.createLiveKitToken(
      callerId,
      callId,
      callerSummary?.fullName ?? callerSummary?.username,
    );
    return {
      ...toCallResponse(call),
      livekit,
    };
  }

  async acceptCall(calleeId: string, callId: string): Promise<AcceptCallResponse> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.calleeId !== calleeId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }

    const answeredAt = new Date();
    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "ACCEPTED",
      answeredAt,
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    this.clearCallTimers(callId);

    // Extend active call locks to max duration (5 hours) for both participants
    await Promise.allSettled([
      this.cache.setRaw(activeCallUserKey(updated.callerId), callId, CALL_ACTIVE_LOCK_TTL_SECONDS),
      this.cache.setRaw(activeCallUserKey(updated.calleeId), callId, CALL_ACTIVE_LOCK_TTL_SECONDS),
    ]);

    let calleeName = calleeId;
    let callerName = updated.callerId;
    if (this.userService) {
      const [calleeUser, callerUser] = await Promise.all([
        this.userService.findById(calleeId),
        this.userService.findById(updated.callerId),
      ]);
      if (calleeUser?.fullName) calleeName = calleeUser.fullName;
      else if (calleeUser?.username) calleeName = calleeUser.username;
      if (callerUser?.fullName) callerName = callerUser.fullName;
      else if (callerUser?.username) callerName = callerUser.username;
    }

    const [livekitCallee, livekitCaller] = await Promise.all([
      this.createLiveKitToken(calleeId, callId, calleeName),
      this.createLiveKitToken(updated.callerId, callId, callerName),
    ]);

    this.realtimeService.joinCall([updated.callerId, updated.calleeId], callId);
    this.realtimeService.emitCallAccepted(callId, {
      callId,
      acceptedBy: calleeId,
      answeredAt,
      livekit: livekitCaller,
    });

    return {
      ...toCallResponse(updated),
      livekit: livekitCallee,
    };
  }

  async rejectCall(calleeId: string, callId: string, reason?: string): Promise<CallResponse> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.calleeId !== calleeId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "REJECTED",
      endedAt: new Date(),
      endReason: reason ?? "REJECTED",
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    this.clearCallTimers(callId);

    await Promise.allSettled([
      this.cache.releaseLock(activeCallUserKey(updated.callerId), callId),
      this.cache.releaseLock(activeCallUserKey(updated.calleeId), callId),
    ]);

    this.realtimeService.emitCallRejected(updated.callerId, {
      callId,
      rejectedBy: calleeId,
      reason,
    });
    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);
    await this.deleteLiveKitRoom(callId);

    return toCallResponse(updated);
  }

  async cancelCall(callerId: string, callId: string): Promise<CallResponse> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.callerId !== callerId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "CANCELLED",
      endedAt: new Date(),
      endReason: "CANCELLED",
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    this.clearCallTimers(callId);

    await Promise.allSettled([
      this.cache.releaseLock(activeCallUserKey(updated.callerId), callId),
      this.cache.releaseLock(activeCallUserKey(updated.calleeId), callId),
    ]);

    this.realtimeService.emitCallCancelled(updated.calleeId, {
      callId,
      cancelledBy: callerId,
    });
    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);
    await this.deleteLiveKitRoom(callId);

    return toCallResponse(updated);
  }

  async endCall(userId: string, callId: string, reason?: string): Promise<CallResponse> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING", "ACCEPTED"], {
      status: "COMPLETED",
      endedAt: new Date(),
      endReason: reason ?? "NORMAL",
    });

    // Call is already in a terminal state — return snapshot without re-emitting events
    if (!updated) {
      return toCallResponse(call);
    }

    this.clearCallTimers(callId);

    await Promise.allSettled([
      this.cache.releaseLock(activeCallUserKey(updated.callerId), callId),
      this.cache.releaseLock(activeCallUserKey(updated.calleeId), callId),
    ]);

    this.realtimeService.emitCallEnded(callId, updated.callerId, updated.calleeId, {
      callId,
      endedBy: userId,
      reason: reason ?? "NORMAL",
      durationSecs: updated.durationSecs ?? 0,
    });
    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);
    await this.deleteLiveKitRoom(callId);

    return toCallResponse(updated);
  }

  async handleRingingTimeout(callId: string): Promise<void> {
    this.ringingTimers.delete(callId);

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "MISSED",
      endedAt: new Date(),
      endReason: "MISSED_TIMEOUT",
    });

    if (!updated) return;

    await Promise.allSettled([
      this.cache.releaseLock(activeCallUserKey(updated.callerId), callId),
      this.cache.releaseLock(activeCallUserKey(updated.calleeId), callId),
    ]);

    this.realtimeService.emitCallEnded(callId, updated.callerId, updated.calleeId, {
      callId,
      reason: "MISSED_TIMEOUT",
      durationSecs: 0,
    });

    this.realtimeService.emitCallMissed(updated.calleeId, {
      callId,
      callerId: updated.callerId,
      media: updated.media,
      reason: "MISSED_TIMEOUT",
    });

    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);
    await this.deleteLiveKitRoom(callId);
  }

  async handleUserDisconnect(userId: string): Promise<void> {
    const activeCall = await this.callRepo.findActiveCallForUser(userId);
    if (!activeCall) return;

    // Callee closed the tab / reloaded / shut the window while still ringing:
    // keep the call ringing for a short grace period in case they come back.
    if (activeCall.status === "RINGING") {
      if (activeCall.calleeId === userId) {
        this.scheduleCalleeRingDisconnect(activeCall.id, userId);
      }
      return;
    }

    if (activeCall.status !== "ACCEPTED") return;

    this.realtimeService.emitCallUserDisconnected(activeCall.id, {
      callId: activeCall.id,
      userId,
    });

    const timerKey = `${activeCall.id}:${userId}`;
    const existing = this.disconnectTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.disconnectTimers.delete(timerKey);
      await this.endCall(userId, activeCall.id, "DISCONNECTED_TIMEOUT").catch(() => {});
    }, CALL_DISCONNECT_GRACE_MS);
    timer.unref();

    this.disconnectTimers.set(timerKey, timer);
  }

  /**
   * Starts the ringing grace period for a callee that dropped mid-ring.
   * Reconnecting (handleUserReconnect) cancels this timer, so an F5 reload
   * keeps the call ringing instead of ending it.
   */
  private scheduleCalleeRingDisconnect(callId: string, calleeId: string): void {
    const timerKey = `${callId}:${calleeId}`;
    const existing = this.disconnectTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(timerKey);
      this.handleCalleeOfflineDuringRing(callId).catch((err: unknown) => {
        this.logger.error(`Failed to end ringing call ${callId} for offline callee`, { err });
      });
    }, CALL_RING_DISCONNECT_GRACE_MS);
    timer.unref();

    this.disconnectTimers.set(timerKey, timer);
  }

  /**
   * Grace period elapsed: the callee never reconnected while the call was
   * ringing, so the call becomes a missed call ended by DISCONNECTED_TIMEOUT.
   */
  private async handleCalleeOfflineDuringRing(callId: string): Promise<void> {
    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "MISSED",
      endedAt: new Date(),
      endReason: "DISCONNECTED_TIMEOUT",
    });

    // Call was answered / rejected / cancelled during the grace period.
    if (!updated) return;

    const ringTimer = this.ringingTimers.get(callId);
    if (ringTimer) {
      clearTimeout(ringTimer);
      this.ringingTimers.delete(callId);
    }

    await Promise.allSettled([
      this.cache.releaseLock(activeCallUserKey(updated.callerId), callId),
      this.cache.releaseLock(activeCallUserKey(updated.calleeId), callId),
    ]);

    this.realtimeService.emitCallMissed(updated.callerId, {
      callId,
      callerId: updated.callerId,
      media: updated.media,
      reason: "DISCONNECTED_TIMEOUT",
    });

    this.realtimeService.emitCallEnded(callId, updated.callerId, updated.calleeId, {
      callId,
      reason: "DISCONNECTED_TIMEOUT",
      durationSecs: 0,
    });

    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);
    await this.deleteLiveKitRoom(callId);
  }

  async handleUserReconnect(userId: string): Promise<void> {
    const activeCall = await this.callRepo.findActiveCallForUser(userId);
    if (!activeCall) return;

    // Rejoin the call room first so the reconnected socket immediately
    // receives subsequent call room events (call:user-disconnected, etc.)
    this.realtimeService.joinCall([userId], activeCall.id);

    // Cancels the in-call disconnect timer and the ringing disconnect timer,
    // so a callee that just reloaded keeps the call ringing.
    const timerKey = `${activeCall.id}:${userId}`;
    const timer = this.disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(timerKey);
    }

    if (activeCall.status === "RINGING") return;

    this.realtimeService.emitCallUserReconnected(activeCall.id, {
      callId: activeCall.id,
      userId,
    });
  }

  async getActiveCall(userId: string): Promise<CallResponse | null> {
    const call = await this.callRepo.findActiveCallForUser(userId);
    return call ? toCallResponse(call) : null;
  }

  async getCallById(userId: string, callId: string): Promise<CallResponse> {
    const call = await this.callRepo.findById(callId);
    if (!call) {
      throw new BusinessError("CALL_NOT_FOUND");
    }
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new BusinessError("CALL_UNAUTHORIZED_PARTICIPANT");
    }
    return toCallResponse(call);
  }

  async listCalls(
    userId: string,
    options: {
      conversationId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<CursorPage<CallResponse>> {
    const limit = options.limit ?? DEFAULT_CALL_PAGE_SIZE;
    if (options.conversationId) {
      const conv = await this.convRepo.findById(options.conversationId, userId);
      if (!conv) {
        throw new BusinessError("NOT_PARTICIPANT");
      }
      const page = await this.callRepo.findCallsByConversation(
        options.conversationId,
        limit,
        options.cursor,
      );
      return {
        ...page,
        items: page.items.map(toCallResponse),
      };
    }

    const page = await this.callRepo.findCallsByUser(userId, limit, options.cursor);
    return {
      ...page,
      items: page.items.map(toCallResponse),
    };
  }

  private clearCallTimers(callId: string): void {
    const ringTimer = this.ringingTimers.get(callId);
    if (ringTimer) {
      clearTimeout(ringTimer);
      this.ringingTimers.delete(callId);
    }

    for (const [key, timer] of this.disconnectTimers.entries()) {
      if (key.startsWith(`${callId}:`)) {
        clearTimeout(timer);
        this.disconnectTimers.delete(key);
      }
    }
  }
}
