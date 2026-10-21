import { Injectable, Logger } from "@nestjs/common";
import type { UserSummary } from "../user/dto/response.js";
import { ChatGateway } from "./chat.gateway.js";
import { convRoom, userRoom } from "./rooms.js";

const logger = new Logger("RealtimeService");

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

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Broadcast a newly created message to the conversation room
   */
  emitNewMessage(conversationId: string, message: unknown): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(convRoom(conversationId)).emit("message:new", message);
    } catch (err) {
      logger.warn(`Failed to emit message:new for conv ${conversationId}: ${String(err)}`);
    }
  }

  /**
   * Broadcast message update (edit)
   */
  emitMessageUpdated(conversationId: string, updated: unknown): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(convRoom(conversationId)).emit("message:updated", updated);
    } catch (err) {
      logger.warn(`Failed to emit message:updated: ${String(err)}`);
    }
  }

  /**
   * Broadcast message revocation (soft delete)
   */
  emitMessageRevoked(conversationId: string, payload: { id: string; deletedAt: Date }): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(convRoom(conversationId)).emit("message:revoked", {
        ...payload,
        conversationId,
      });
    } catch (err) {
      logger.warn(`Failed to emit message:revoked: ${String(err)}`);
    }
  }

  /**
   * Broadcast read receipt update
   */
  emitReadUpdated(
    conversationId: string,
    payload: { userId: string; lastReadMessageId: string; readAt: Date },
  ): void {
    if (!this.gateway?.server) return;
    try {
      this.gateway.server.to(convRoom(conversationId)).emit("read:updated", {
        ...payload,
        conversationId,
      });
    } catch (err) {
      logger.warn(`Failed to emit read:updated: ${String(err)}`);
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
   * Make every socket of the given participants join the conversation room.
   * Best-effort: no server (REST-only bootstrap / unit tests) is a no-op and
   * failures are logged, never thrown — conversation creation must not fail
   * because realtime is unavailable. Idempotent on repeat calls.
   */
  joinConversation(participantIds: string[], conversationId: string): void {
    if (!this.gateway?.server) return;
    const room = convRoom(conversationId);
    try {
      for (const userId of participantIds) {
        this.gateway.server.in(userRoom(userId)).socketsJoin(room);
      }
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
}

