import { Injectable, Logger } from "@nestjs/common";
import type { UserSummary } from "../user/dto/response.js";
import type { MessageReactionSummary, MessageResponse } from "../message/dto/response.js";
import { ChatGateway } from "./chat.gateway.js";
import { callRoom, convRoom, userRoom } from "./rooms.js";
import type {
  CallAcceptedPayload,
  CallCancelledPayload,
  CallEndedPayload,
  CallIncomingPayload,
  CallMissedPayload,
  CallRejectedPayload,
} from "../call/types.js";

const logger = new Logger("RealtimeService");

export interface UserMessagePayload {
  userId: string;
  payload: MessageResponse;
}

export interface StoryReactionEvent {
  storyId: string;
  user: UserSummary;
  emoji: string;
  createdAt: Date;
}

export interface StoryReactionRemovedEvent {
  storyId: string;
  user: UserSummary;
}

export interface FriendRequestCancelledEvent {
  requestId: string;
  requesterId: string;
}

export interface FriendRequestAcceptedEvent {
  requestId: string;
  addresseeId: string;
}

export interface FriendRequestDeclinedEvent {
  requestId: string;
  addresseeId: string;
}

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Broadcast a newly created message to the conversation room
   */
  emitNewMessage(
    conversationId: string,
    message: MessageResponse,
    recipientPayloads?: UserMessagePayload[],
  ): void {
    if (!this.gateway?.server) return;
    const { clientMsgId, ...publicMessage } = message;
    if (clientMsgId) {
      try {
        this.gateway.server.to(userRoom(message.senderId)).emit("message:correlated", {
          conversationId,
          id: message.id,
          clientMsgId,
        });
      } catch (err) {
        logger.warn(
          `Failed to emit message correlation for conv ${conversationId}: ${String(err)}`,
        );
      }
    }
    if (recipientPayloads) {
      for (const { userId, payload } of recipientPayloads) {
        try {
          const { clientMsgId: _recipientClientMsgId, ...recipientMessage } = payload;
          this.gateway.server.to(userRoom(userId)).emit("message:new", recipientMessage);
        } catch (err) {
          logger.warn(`Failed to emit message:new for user ${userId}: ${String(err)}`);
        }
      }
      return;
    }
    try {
      this.gateway.server.to(convRoom(conversationId)).emit("message:new", publicMessage);
    } catch (err) {
      logger.warn(`Failed to emit message:new for conv ${conversationId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast message update (edit)
   */
  emitMessageUpdated(
    conversationId: string,
    updated: MessageResponse,
    recipientUserIds?: string[],
  ): void {
    if (!this.gateway?.server) return;
    try {
      if (recipientUserIds) {
        for (const userId of recipientUserIds)
          this.gateway.server.to(userRoom(userId)).emit("message:updated", updated);
      } else this.gateway.server.to(convRoom(conversationId)).emit("message:updated", updated);
    } catch (err) {
      logger.warn(`Failed to emit message:updated: ${String(err)}`);
    }
  }

  /**
   * Broadcast message revocation (soft delete)
   */
  emitMessageRevoked(
    conversationId: string,
    payload: { id: string; deletedAt: Date },
    recipientUserIds?: string[],
  ): void {
    if (!this.gateway?.server) return;
    try {
      const event = {
        ...payload,
        conversationId,
      };
      if (recipientUserIds) {
        for (const userId of recipientUserIds)
          this.gateway.server.to(userRoom(userId)).emit("message:revoked", event);
      } else this.gateway.server.to(convRoom(conversationId)).emit("message:revoked", event);
    } catch (err) {
      logger.warn(`Failed to emit message:revoked: ${String(err)}`);
    }
  }

  emitMessageHidden(userId: string, conversationId: string, messageId: string): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server
        .to(userRoom(userId))
        .emit("message:hidden", { conversationId, messageId });
    } catch (err) {
      logger.warn(`Failed to emit message:hidden for conv ${conversationId}: ${String(err)}`);
    }
  }

  leaveConversation(userIds: string[], conversationId: string): void {
    if (!this.gateway?.server) return;
    const room = convRoom(conversationId);
    try {
      for (const userId of userIds) this.gateway.server.in(userRoom(userId)).socketsLeave(room);
    } catch (err) {
      logger.warn(`Failed to remove users from conv ${conversationId}: ${String(err)}`);
    }
  }

  emitGroupEvent(userIds: string[], event: string, payload: unknown): void {
    if (!this.gateway?.server) return;
    try {
      for (const userId of userIds) this.gateway.server.to(userRoom(userId)).emit(event, payload);
    } catch (err) {
      logger.warn(`Failed to emit group event ${event}: ${String(err)}`);
    }
  }

  /**
   * Broadcast read receipt update
   */
  emitReadUpdated(
    conversationId: string,
    payload: { userId: string; lastReadMessageId: string; readAt: Date },
    recipientUserIds?: string[],
  ): void {
    if (!this.gateway?.server) return;
    try {
      const event = {
        ...payload,
        conversationId,
      };
      if (recipientUserIds) {
        for (const userId of recipientUserIds)
          this.gateway.server.to(userRoom(userId)).emit("read:updated", event);
      } else this.gateway.server.to(convRoom(conversationId)).emit("read:updated", event);
    } catch (err) {
      logger.warn(`Failed to emit read:updated: ${String(err)}`);
    }
  }

  /**
   * Broadcast message reaction update to conversation room
   */
  emitMessageReaction(
    conversationId: string,
    payload: {
      messageId: string;
      userId: string;
      emoji: string;
      reactions: MessageReactionSummary[];
    },
    recipientUserIds?: string[],
  ): void {
    if (!this.gateway?.server) return;
    try {
      const event = {
        ...payload,
        conversationId,
      };
      if (recipientUserIds) {
        for (const userId of recipientUserIds)
          this.gateway.server.to(userRoom(userId)).emit("message:reaction", event);
      } else this.gateway.server.to(convRoom(conversationId)).emit("message:reaction", event);
    } catch (err) {
      logger.warn(`Failed to emit message:reaction for conv ${conversationId}: ${String(err)}`);
    }
  }

  emitFriendRequestReceived(
    userId: string,
    payload: { id: string; user: { id: string; name: string; username: string } },
  ): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("friend:request:new", payload);
    } catch (err) {
      logger.warn(`Failed to emit friend:request:new for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast friend request cancellation to the recipient's personal room
   */
  emitFriendRequestCancelled(userId: string, payload: FriendRequestCancelledEvent): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("friend:request:cancelled", payload);
    } catch (err) {
      logger.warn(`Failed to emit friend:request:cancelled for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast friend request acceptance to the requester's personal room
   */
  emitFriendRequestAccepted(userId: string, payload: FriendRequestAcceptedEvent): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("friend:request:accepted", payload);
    } catch (err) {
      logger.warn(`Failed to emit friend:request:accepted for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast friend request decline to the requester's personal room
   */
  emitFriendRequestDeclined(userId: string, payload: FriendRequestDeclinedEvent): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("friend:request:declined", payload);
    } catch (err) {
      logger.warn(`Failed to emit friend:request:declined for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast friend removal event to both users
   */
  emitFriendRemoved(userIdA: string, userIdB: string): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userIdA)).emit("friend:removed", { friendId: userIdB });
      this.gateway.server.to(userRoom(userIdB)).emit("friend:removed", { friendId: userIdA });
    } catch (err) {
      logger.warn(`Failed to emit friend:removed for users ${userIdA}, ${userIdB}: ${String(err)}`);
    }
  }

  /**
   * Make every socket of the given participants join the conversation room.
   * Best-effort: no server (REST-only bootstrap / unit tests) is a no-op and
   * failures are logged, never thrown — conversation creation must not fail
   * because realtime is unavailable. Idempotent on repeat calls.
   */
  joinConversation(participantIds: string[], conversationId: string): void {
    if (!this.gateway?.server || participantIds.length === 0) return;
    const room = convRoom(conversationId);
    try {
      // One adapter round trip: `.in()` unions the participant user rooms.
      this.gateway.server.in(participantIds.map(userRoom)).socketsJoin(room);
    } catch (err) {
      logger.warn(`Failed to join participants to conv ${conversationId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast a story reaction to the story author's personal room
   */
  emitStoryReaction(userId: string, payload: StoryReactionEvent): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("story:reaction", payload);
    } catch (err) {
      logger.warn(`Failed to emit story:reaction for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast the removal of a story reaction to the story author's room
   */
  emitStoryReactionRemoved(userId: string, payload: StoryReactionRemovedEvent): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(userId)).emit("story:reaction:removed", payload);
    } catch (err) {
      logger.warn(`Failed to emit story:reaction:removed for user ${userId}: ${String(err)}`);
    }
  }

  /**
   * Make sockets of the given participants join the call room.
   */
  joinCall(participantIds: string[], callId: string): void {
    if (!this.gateway?.server || participantIds.length === 0) return;
    const room = callRoom(callId);
    try {
      this.gateway.server.in(participantIds.map(userRoom)).socketsJoin(room);
    } catch (err) {
      logger.warn(`Failed to join participants to call ${callId}: ${String(err)}`);
    }
  }

  /**
   * Remove sockets of the given participants from the call room.
   */
  leaveCall(participantIds: string[], callId: string): void {
    if (!this.gateway?.server || participantIds.length === 0) return;
    const room = callRoom(callId);
    try {
      this.gateway.server.in(participantIds.map(userRoom)).socketsLeave(room);
    } catch (err) {
      logger.warn(`Failed to leave participants from call ${callId}: ${String(err)}`);
    }
  }

  /**
   * Emit incoming call invitation to callee's personal room.
   */
  emitCallIncoming(calleeId: string, payload: CallIncomingPayload): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(calleeId)).emit("call:incoming", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:incoming to user ${calleeId}: ${String(err)}`);
    }
  }

  /**
   * Emit call accepted event to call room and participant rooms.
   */
  emitCallAccepted(callId: string, payload: CallAcceptedPayload): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(callRoom(callId)).emit("call:accepted", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:accepted for call ${callId}: ${String(err)}`);
    }
  }

  /**
   * Emit call rejected event to caller.
   */
  emitCallRejected(callerId: string, payload: CallRejectedPayload): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(callerId)).emit("call:rejected", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:rejected to user ${callerId}: ${String(err)}`);
    }
  }

  /**
   * Emit call cancelled event to callee.
   */
  emitCallCancelled(calleeId: string, payload: CallCancelledPayload): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(calleeId)).emit("call:cancelled", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:cancelled to user ${calleeId}: ${String(err)}`);
    }
  }

  /**
   * Emit missed call event to callee.
   */
  emitCallMissed(calleeId: string, payload: CallMissedPayload): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(userRoom(calleeId)).emit("call:missed", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:missed to user ${calleeId}: ${String(err)}`);
    }
  }

  /**
   * Emit call ended event to call room and both participants.
   */
  emitCallEnded(
    callId: string,
    callerId: string,
    calleeId: string,
    payload: CallEndedPayload,
  ): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(callRoom(callId)).emit("call:ended", payload);
      this.gateway.server.to(userRoom(callerId)).emit("call:ended", payload);
      this.gateway.server.to(userRoom(calleeId)).emit("call:ended", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:ended for call ${callId}: ${String(err)}`);
    }
  }

  /**
   * Emit temporary disconnect notification during an ongoing call.
   */
  emitCallUserDisconnected(callId: string, payload: { callId: string; userId: string }): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(callRoom(callId)).emit("call:user-disconnected", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:user-disconnected for call ${callId}: ${String(err)}`);
    }
  }

  /**
   * Emit reconnected notification during an ongoing call.
   */
  emitCallUserReconnected(callId: string, payload: { callId: string; userId: string }): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(callRoom(callId)).emit("call:user-reconnected", payload);
    } catch (err) {
      logger.warn(`Failed to emit call:user-reconnected for call ${callId}: ${String(err)}`);
    }
  }
}
