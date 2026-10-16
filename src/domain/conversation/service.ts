import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { AppHttpException } from "../../utils/response.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import { CONVERSATION_REPOSITORY, type ConversationRepository, type ConversationWithPartner } from "./repository.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { unreadCountKey } from "../../utils/cache/keys.js";
import { RealtimeService } from "../realtime/realtime.service.js";

@Injectable()
export class ConversationService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async getOrCreateDirect(userId: string, targetUserId: string): Promise<ConversationWithPartner> {
    if (userId === targetUserId) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, "CANNOT_CHAT_WITH_SELF", "Không thể tự tạo hội thoại với chính mình");
    }

    const targetUser = await this.userRepo.findById(targetUserId);
    if (!targetUser) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "Người dùng không tồn tại");
    }

    const existing = await this.convRepo.findDirectByParticipants(userId, targetUserId);
    if (existing) {
      return existing;
    }

    return await this.convRepo.createDirectConversation(userId, targetUserId);
  }

  async listConversations(userId: string, limit = 20): Promise<ConversationWithPartner[]> {
    const list = await this.convRepo.findUserConversations(userId, limit);

    // Enrich with unread counts from Redis
    if (this.redis && list.length > 0) {
      try {
        const pipeline = this.redis.pipeline();
        for (const conv of list) {
          pipeline.get(unreadCountKey(userId, conv.id));
        }
        const results = await pipeline.exec();
        if (results) {
          results.forEach(([err, val], idx) => {
            if (!err && val) {
              list[idx].unreadCount = parseInt(val as string, 10) || 0;
            } else {
              list[idx].unreadCount = 0;
            }
          });
        }
      } catch {
        // Fallback gracefully to 0 if Redis fails
      }
    }

    return list;
  }

  async getById(conversationId: string, userId: string): Promise<ConversationWithPartner> {
    const exists = await this.convRepo.existsById(conversationId);
    if (!exists) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện");
    }

    const conv = await this.convRepo.findById(conversationId, userId);
    if (!conv) {
      throw new AppHttpException(HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "Không phải thành viên cuộc trò chuyện");
    }
    return conv;
  }

  async markAsRead(conversationId: string, userId: string, lastReadMessageId: string): Promise<void> {
    await this.getById(conversationId, userId);

    await this.convRepo.updateLastRead(conversationId, userId, lastReadMessageId);

    // Reset unread counter in Redis
    if (this.redis) {
      try {
        await this.redis.del(unreadCountKey(userId, conversationId));
      } catch {
        // Best-effort
      }
    }

    // Broadcast to room
    this.realtimeService.emitReadUpdated(conversationId, {
      userId,
      lastReadMessageId,
      readAt: new Date(),
    });
  }
}

