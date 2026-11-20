import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { get_env } from "../../helpers/index.js";
import { activeCallUserKey, iceServersCacheKey } from "../../utils/cache/keys.js";
import { CACHE_STORE, type CacheStore } from "../../utils/cache/store.js";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { UserService } from "../user/service.js";
import type { CursorPage } from "../shared.js";
import {
  CALL_ACTIVE_LOCK_TTL_SECONDS,
  CALL_DISCONNECT_GRACE_MS,
  CALL_RING_TIMEOUT_MS,
  DEFAULT_CALL_PAGE_SIZE,
  DEFAULT_STUN_SERVERS,
  METERED_ICE_CACHE_TTL_SECONDS,
} from "./constants.js";
import type { InitiateCallDto } from "./dto/request.js";
import type { AcceptCallResponse, CallResponse, InitiateCallResponse } from "./dto/response.js";
import { toCallResponse } from "./dto/mapper.js";
import { CALL_REPOSITORY, type CallRepository } from "./repository.js";
import type { RTCIceServer } from "./types.js";

@Injectable()
export class CallService implements OnApplicationShutdown {
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

  async getIceServers(): Promise<RTCIceServer[]> {
    try {
      const cached = await this.cache.getRaw(iceServersCacheKey());
      if (cached) {
        const parsed = JSON.parse(cached) as RTCIceServer[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Non-critical cache read: fail-open
    }

    const domain = get_env("METERED_DOMAIN", "");
    const apiKey = get_env("METERED_SECRET_KEY", "");
    if (domain && apiKey) {
      try {
        const response = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const servers = (await response.json()) as RTCIceServer[];
          if (Array.isArray(servers) && servers.length > 0) {
            await this.cache
              .setRaw(iceServersCacheKey(), JSON.stringify(servers), METERED_ICE_CACHE_TTL_SECONDS)
              .catch(() => {});
            return servers;
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch Metered ICE servers: ${String(err)}`);
      }
    }

    return DEFAULT_STUN_SERVERS;
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

    const callerLockKey = activeCallUserKey(callerId);
    const callerLocked = await this.cache.tryAcquireLock(
      callerLockKey,
      "pending",
      CALL_ACTIVE_LOCK_TTL_SECONDS,
    );
    if (!callerLocked) {
      throw new BusinessError("CALL_USER_BUSY");
    }

    const calleeLockKey = activeCallUserKey(calleeId);
    const calleeLocked = await this.cache.tryAcquireLock(
      calleeLockKey,
      "pending",
      CALL_ACTIVE_LOCK_TTL_SECONDS,
    );
    if (!calleeLocked) {
      await this.cache.releaseLock(callerLockKey, "pending").catch(() => {});
      throw new BusinessError("CALL_USER_BUSY");
    }

    let call;
    try {
      call = await this.callRepo.createCall({
        conversationId: dto.conversationId,
        callerId,
        calleeId,
        media: dto.media,
      });
    } catch (err) {
      await Promise.allSettled([
        this.cache.releaseLock(callerLockKey, "pending"),
        this.cache.releaseLock(calleeLockKey, "pending"),
      ]);
      throw err;
    }

    const callId = call.id;

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

    const iceServers = await this.getIceServers();
    return {
      ...toCallResponse(call),
      iceServers,
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

    const existingTimer = this.ringingTimers.get(callId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.ringingTimers.delete(callId);
    }

    const answeredAt = new Date();
    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "ACCEPTED",
      answeredAt,
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    this.realtimeService.joinCall([updated.callerId, updated.calleeId], callId);
    this.realtimeService.emitCallAccepted(callId, {
      callId,
      acceptedBy: calleeId,
      answeredAt,
    });

    const iceServers = await this.getIceServers();
    return {
      ...toCallResponse(updated),
      iceServers,
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

    const timer = this.ringingTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringingTimers.delete(callId);
    }

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "REJECTED",
      endedAt: new Date(),
      endReason: reason ?? "REJECTED",
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    await Promise.allSettled([
      this.cache.delete(activeCallUserKey(updated.callerId)),
      this.cache.delete(activeCallUserKey(updated.calleeId)),
    ]);

    this.realtimeService.emitCallRejected(updated.callerId, {
      callId,
      rejectedBy: calleeId,
      reason,
    });
    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);

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

    const timer = this.ringingTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringingTimers.delete(callId);
    }

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING"], {
      status: "CANCELLED",
      endedAt: new Date(),
      endReason: "CANCELLED",
    });

    if (!updated) {
      throw new BusinessError("CALL_INVALID_STATE");
    }

    await Promise.allSettled([
      this.cache.delete(activeCallUserKey(updated.callerId)),
      this.cache.delete(activeCallUserKey(updated.calleeId)),
    ]);

    this.realtimeService.emitCallCancelled(updated.calleeId, {
      callId,
      cancelledBy: callerId,
    });
    this.realtimeService.leaveCall([updated.callerId, updated.calleeId], callId);

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

    this.clearCallTimers(callId);

    const updated = await this.callRepo.updateStatus(callId, ["INITIATED", "RINGING", "ACCEPTED"], {
      status: "COMPLETED",
      endedAt: new Date(),
      endReason: reason ?? "NORMAL",
    });

    const finalCall = updated ?? call;

    await Promise.allSettled([
      this.cache.delete(activeCallUserKey(finalCall.callerId)),
      this.cache.delete(activeCallUserKey(finalCall.calleeId)),
    ]);

    this.realtimeService.emitCallEnded(callId, finalCall.callerId, finalCall.calleeId, {
      callId,
      endedBy: userId,
      reason: reason ?? "NORMAL",
      durationSecs: finalCall.durationSecs ?? 0,
    });
    this.realtimeService.leaveCall([finalCall.callerId, finalCall.calleeId], callId);

    return toCallResponse(finalCall);
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
      this.cache.delete(activeCallUserKey(updated.callerId)),
      this.cache.delete(activeCallUserKey(updated.calleeId)),
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
  }

  async handleUserDisconnect(userId: string): Promise<void> {
    const activeCall = await this.callRepo.findActiveCallForUser(userId);
    if (!activeCall || activeCall.status !== "ACCEPTED") return;

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

  async handleUserReconnect(userId: string): Promise<void> {
    const activeCall = await this.callRepo.findActiveCallForUser(userId);
    if (!activeCall) return;

    const timerKey = `${activeCall.id}:${userId}`;
    const timer = this.disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(timerKey);
    }

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
