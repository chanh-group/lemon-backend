import { Inject, Injectable, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import { CONVERSATION_REPOSITORY, type ConversationRepository } from "./repository.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { presenceUserKey, unreadCountKey } from "../../utils/cache/keys.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import type { ConversationResponse } from "./dto/response.js";
import { toConversationResponse } from "./dto/mapper.js";

@Injectable()
export class ConversationService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async getOrCreateDirect(userId: string, targetUserId: string): Promise<ConversationResponse> {
    if (!targetUserId || typeof targetUserId !== "string" || targetUserId.trim().length === 0) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (userId === targetUserId) {
      throw new BusinessError("CANNOT_CHAT_WITH_SELF");
    }

    const targetUser = await this.userRepo.findById(targetUserId);
    if (!targetUser) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    const existing = await this.convRepo.findDirectByParticipants(userId, targetUserId);
    if (existing) {
      return toConversationResponse(existing);
    }

    return toConversationResponse(
      await this.convRepo.createDirectConversation(userId, targetUserId),
    );
  }

  async listConversations(userId: string, limit = 20): Promise<ConversationResponse[]> {
    const list = await this.convRepo.findUserConversations(userId, limit);

    // Enrich with unread counts and presence from Redis
    if (this.redis && list.length > 0) {
      try {
        const pipeline = this.redis.pipeline();
        for (const conv of list) {
          pipeline.get(unreadCountKey(userId, conv.id));
        }
        for (const conv of list) {
          if (conv.partner) {
            pipeline.get(presenceUserKey(conv.partner.id));
          }
        }
        const results = await pipeline.exec();
        if (results) {
          for (let i = 0; i < list.length; i++) {
            const [err, val] = results[i];
            list[i].unreadCount = !err && val ? parseInt(val as string, 10) || 0 : 0;
          }

          let partnerIdx = list.length;
          for (let i = 0; i < list.length; i++) {
            if (list[i].partner) {
              const [err, val] = results[partnerIdx++];
              if (!err && val) {
                try {
                  const presence = JSON.parse(val as string);
                  list[i].partner!.isOnline = presence.state === "online";
                } catch {
                  list[i].partner!.isOnline = false;
                }
              } else {
                list[i].partner!.isOnline = false;
              }
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    return list.map(toConversationResponse);
  }

  async getById(conversationId: string, userId: string): Promise<ConversationResponse> {
    const exists = await this.convRepo.existsById(conversationId);
    if (!exists) {
      throw new BusinessError("CONVERSATION_NOT_FOUND");
    }

    const conv = await this.convRepo.findById(conversationId, userId);
    if (!conv) {
      throw new BusinessError("NOT_PARTICIPANT");
    }

    // Enrich with unreadCount and presence from Redis
    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        pipeline.get(unreadCountKey(userId, conversationId));
        if (conv.partner) {
          pipeline.get(presenceUserKey(conv.partner.id));
        }
        const results = await pipeline.exec();
        if (results) {
          const [errCount, valCount] = results[0];
          conv.unreadCount = !errCount && valCount ? parseInt(valCount as string, 10) || 0 : 0;
          if (conv.partner && results.length > 1) {
            const [errPres, valPres] = results[1];
            if (!errPres && valPres) {
              try {
                const presence = JSON.parse(valPres as string);
                conv.partner.isOnline = presence.state === "online";
              } catch {
                conv.partner.isOnline = false;
              }
            } else {
              conv.partner.isOnline = false;
            }
          }
        }
      } catch {
        conv.unreadCount = 0;
      }
    }

    return toConversationResponse(conv);
  }

  async markAsRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<void> {
    if (
      !lastReadMessageId ||
      typeof lastReadMessageId !== "string" ||
      lastReadMessageId.trim().length === 0
    ) {
      throw new BusinessError("BAD_REQUEST");
    }

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
