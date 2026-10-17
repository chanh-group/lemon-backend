import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { AppHttpException } from "../../utils/response.js";
import { CONVERSATION_REPOSITORY, type ConversationRepository } from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { MESSAGE_REPOSITORY, type MessageRepository, type MessageTimelineResult } from "./repository.js";
import { type Message } from "./schema.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { unreadCountKey } from "../../utils/cache/keys.js";

export interface SendMessageDto {
  body?: string;
  kind?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "SYSTEM";
  clientMsgId?: string;
  replyToId?: string;
}

@Injectable()
export class MessageService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepo: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async sendMessage(senderId: string, conversationId: string, dto: SendMessageDto): Promise<Message> {
    // 1. Verify that sender is a member of this conversation
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(senderId)) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "Không phải thành viên cuộc trò chuyện");
    }

    if ((!dto.kind || dto.kind === "TEXT") && (!dto.body || dto.body.trim().length === 0)) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Nội dung tin nhắn không được để trống");
    }

    if (dto.body && dto.body.length > 4000) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Nội dung tin nhắn không được vượt quá 4000 ký tự");
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
      throw new AppHttpException(HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "Không phải thành viên cuộc trò chuyện");
    }

    return await this.messageRepo.findTimeline(conversationId, cursor, limit, after);
  }

  async editMessage(userId: string, messageId: string, body: string): Promise<Message> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn");
    }

    if (msg.deletedAt) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "MESSAGE_REVOKED", "Tin nhắn đã bị thu hồi, không thể chỉnh sửa");
    }

    if (msg.senderId !== userId) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Bạn không có quyền chỉnh sửa tin nhắn này");
    }

    if (msg.kind !== "TEXT") {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Chỉ có thể chỉnh sửa tin nhắn văn bản");
    }

    if (!body || body.trim().length === 0) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Nội dung tin nhắn không được để trống");
    }

    if (body.length > 4000) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Nội dung tin nhắn không được vượt quá 4000 ký tự");
    }

    const updated = await this.messageRepo.updateBody(messageId, userId, body);
    if (!updated) {
      throw new AppHttpException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR", "Lỗi khi cập nhật tin nhắn");
    }

    this.realtimeService.emitMessageUpdated(updated.conversationId, updated);
    return updated;
  }

  async revokeMessage(userId: string, messageId: string): Promise<Message> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn");
    }

    if (msg.deletedAt) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "MESSAGE_REVOKED", "Tin nhắn đã được thu hồi trước đó");
    }

    if (msg.senderId !== userId) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Bạn không có quyền thu hồi tin nhắn này");
    }

    const revoked = await this.messageRepo.softDelete(messageId, userId);
    if (!revoked) {
      throw new AppHttpException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR", "Lỗi khi thu hồi tin nhắn");
    }

    this.realtimeService.emitMessageRevoked(revoked.conversationId, {
      id: revoked.id,
      deletedAt: revoked.deletedAt!,
    });
    return revoked;
  }
}

