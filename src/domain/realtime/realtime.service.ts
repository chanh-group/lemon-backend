import { Injectable, Logger } from "@nestjs/common";
import { ChatGateway } from "./chat.gateway.js";
import { convRoom, userRoom } from "./rooms.js";

const logger = new Logger("RealtimeService");

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
      this.gateway.server.to(convRoom(conversationId)).emit("message:revoked", payload);
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
      this.gateway.server.to(convRoom(conversationId)).emit("read:updated", payload);
    } catch (err) {
      logger.warn(`Failed to emit read:updated: ${String(err)}`);
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
}
