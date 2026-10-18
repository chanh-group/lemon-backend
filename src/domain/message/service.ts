import { Inject, Injectable, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
  type MessageTimelineResult,
} from "./repository.js";
import { type Message } from "./schema.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { unreadCountKey } from "../../utils/cache/keys.js";
import type { SendMessageDto } from "./dto/request.js";

export type { SendMessageDto };

@Injectable()
export class MessageService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepo: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    // 1. Verify that sender is a member of this conversation
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(senderId)) {
      throw new BusinessError("NOT_PARTICIPANT");
    }

    if ((!dto.kind || dto.kind === "TEXT") && (!dto.body || dto.body.trim().length === 0)) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (dto.body && dto.body.length > 4000) {
      throw new BusinessError("BAD_REQUEST");
    }

    // 2. Persist message in PostgreSQL with transaction
    const { message, isNew } = await this.messageRepo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: dto.body,
      kind: dto.kind ?? "TEXT",
      clientMsgId: dto.clientMsgId,
      replyToId: dto.replyToId,
    });

    if (isNew) {
      const recipientIds = participantIds.filter((id) => id !== senderId);

      // 3. Atomically increment unread counter in Redis for recipients
      if (this.redis && recipientIds.length > 0) {
        try {
          const pipeline = this.redis.pipeline();
          for (const recipientId of recipientIds) {
            pipeline.incr(unreadCountKey(recipientId, conversationId));
          }
          await pipeline.exec();
        } catch {
          // Best-effort cache
        }
      }

      // 4. Emit realtime event to conversation room and recipients
      this.realtimeService.emitNewMessage(conversationId, message, recipientIds);
    }

    return message;
  }

  async getTimeline(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
    after?: string,
  ): Promise<MessageTimelineResult> {
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(userId)) {
      throw new BusinessError("NOT_PARTICIPANT");
    }

    return await this.messageRepo.findTimeline(conversationId, cursor, limit, after);
  }

  async editMessage(userId: string, messageId: string, body: string): Promise<Message> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }

    if (msg.deletedAt) {
      throw new BusinessError("MESSAGE_REVOKED");
    }

    if (msg.senderId !== userId) {
      throw new BusinessError("FORBIDDEN");
    }

    if (msg.kind !== "TEXT") {
      throw new BusinessError("BAD_REQUEST");
    }

    if (!body || body.trim().length === 0) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (body.length > 4000) {
      throw new BusinessError("BAD_REQUEST");
    }

    const updated = await this.messageRepo.updateBody(messageId, userId, body);
    if (!updated) {
      throw new BusinessError("INTERNAL_SERVER_ERROR" as any);
    }

    this.realtimeService.emitMessageUpdated(updated.conversationId, updated);
    return updated;
  }

  async revokeMessage(userId: string, messageId: string): Promise<Message> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }

    if (msg.deletedAt) {
      throw new BusinessError("MESSAGE_REVOKED");
    }

    if (msg.senderId !== userId) {
      throw new BusinessError("FORBIDDEN");
    }

    const revoked = await this.messageRepo.softDelete(messageId, userId);
    if (!revoked) {
      throw new BusinessError("INTERNAL_SERVER_ERROR" as any);
    }

    this.realtimeService.emitMessageRevoked(revoked.conversationId, {
      id: revoked.id,
      deletedAt: revoked.deletedAt!,
    });
    return revoked;
  }
}
