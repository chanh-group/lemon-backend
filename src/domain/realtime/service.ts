import { Injectable, Logger } from "@nestjs/common";
import type { MessageReactionSummary, MessageResponse } from "../message/dto/response.js";
import { ChatGateway } from "./gateway.js";
import { REALTIME_EVENTS } from "./constants.js";
import { callRoom, convRoom, userRoom } from "./rooms.js";
import type {
  CallAcceptedPayload,
  CallCancelledPayload,
  CallEndedPayload,
  CallIncomingPayload,
  CallMissedPayload,
  CallRejectedPayload,
} from "../call/types.js";
import type {
  FriendRequestAcceptedEvent,
  FriendRequestCancelledEvent,
  FriendRequestDeclinedEvent,
  StoryReactionEvent,
  StoryReactionRemovedEvent,
  UserMessagePayload,
} from "./types.js";

// Re-exported for consumers that import these from the service module.
export type {
  FriendRequestAcceptedEvent,
  FriendRequestCancelledEvent,
  FriendRequestDeclinedEvent,
  StoryReactionEvent,
  StoryReactionRemovedEvent,
  UserMessagePayload,
} from "./types.js";

const logger = new Logger("RealtimeService");

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
        this.gateway.server
          .to(userRoom(message.senderId))
          .emit(REALTIME_EVENTS.MESSAGE_CORRELATED, {
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
          this.gateway.server
            .to(userRoom(userId))
            .emit(REALTIME_EVENTS.MESSAGE_NEW, recipientMessage);
        } catch (err) {
          logger.warn(`Failed to emit message:new for user ${userId}: ${String(err)}`);
        }
      }
      return;
    }
    try {
      this.gateway.server
        .to(convRoom(conversationId))
        .emit(REALTIME_EVENTS.MESSAGE_NEW, publicMessage);
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
          this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.MESSAGE_UPDATED, updated);
      } else
        this.gateway.server
          .to(convRoom(conversationId))
          .emit(REALTIME_EVENTS.MESSAGE_UPDATED, updated);
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
          this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.MESSAGE_REVOKED, event);
      } else
        this.gateway.server
          .to(convRoom(conversationId))
          .emit(REALTIME_EVENTS.MESSAGE_REVOKED, event);
    } catch (err) {
      logger.warn(`Failed to emit message:revoked: ${String(err)}`);
    }
  }

  emitMessageHidden(userId: string, conversationId: string, messageId: string): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server
        .to(userRoom(userId))
        .emit(REALTIME_EVENTS.MESSAGE_HIDDEN, { conversationId, messageId });
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
          this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.READ_UPDATED, event);
      } else
        this.gateway.server.to(convRoom(conversationId)).emit(REALTIME_EVENTS.READ_UPDATED, event);
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
          this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.MESSAGE_REACTION, event);
      } else
        this.gateway.server
          .to(convRoom(conversationId))
          .emit(REALTIME_EVENTS.MESSAGE_REACTION, event);
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
      this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.FRIEND_REQUEST_NEW, payload);
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
      this.gateway.server
        .to(userRoom(userId))
        .emit(REALTIME_EVENTS.FRIEND_REQUEST_CANCELLED, payload);
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
      this.gateway.server
        .to(userRoom(userId))
        .emit(REALTIME_EVENTS.FRIEND_REQUEST_ACCEPTED, payload);
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
      this.gateway.server
        .to(userRoom(userId))
        .emit(REALTIME_EVENTS.FRIEND_REQUEST_DECLINED, payload);
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
      this.gateway.server
        .to(userRoom(userIdA))
        .emit(REALTIME_EVENTS.FRIEND_REMOVED, { friendId: userIdB });
      this.gateway.server
        .to(userRoom(userIdB))
        .emit(REALTIME_EVENTS.FRIEND_REMOVED, { friendId: userIdA });
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
      this.gateway.server.to(userRoom(userId)).emit(REALTIME_EVENTS.STORY_REACTION, payload);
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
      this.gateway.server
        .to(userRoom(userId))
        .emit(REALTIME_EVENTS.STORY_REACTION_REMOVED, payload);
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
      // Single emit: Socket.IO de-duplicates sockets that belong to several of the rooms.
      this.gateway.server
        .to(callRoom(callId))
        .to(userRoom(callerId))
        .to(userRoom(calleeId))
        .emit("call:ended", payload);
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
