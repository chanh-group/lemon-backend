import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import { CONVERSATION_REPOSITORY, type ConversationRepository } from "./repository.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { UNREAD_TTL_SECONDS } from "../../utils/cache/constants.js";
import { presenceUserKey, unreadCountKey } from "../../utils/cache/keys.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import type { ConversationResponse } from "./dto/response.js";
import { toConversationResponse } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    private readonly friendService: FriendService,
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

    await this.friendService.assertCanChat(userId, targetUserId);

    const existing = await this.convRepo.findDirectByParticipants(userId, targetUserId);
    const conversation =
      existing ?? (await this.convRepo.createDirectConversation(userId, targetUserId));

    this.joinParticipantsBestEffort(conversation.id, [userId, targetUserId]);

    return toConversationResponse(conversation);
  }

  private joinParticipantsBestEffort(conversationId: string, participantIds: string[]): void {
    try {
      this.realtimeService.joinConversation(participantIds, conversationId);
    } catch (err) {
      this.logger.warn("Failed to join participants to the conversation room", {
        conversationId,
        err,
      });
    }
  }

  async listConversations(userId: string, limit = 20): Promise<ConversationResponse[]> {
    const conversations = await this.convRepo.findUserConversations(userId, limit);
    const friendIds = new Set((await this.friendService.listFriends(userId)).map((friend) => friend.id));
    const list = conversations.filter(
      (conversation) =>
        conversation.kind !== "DIRECT" ||
        Boolean(conversation.partner && friendIds.has(conversation.partner.id)),
    );

    // Enrich with unread counts and presence from Redis
    if (this.redis && list.length > 0) {
      let results: [Error | null, unknown][] | null = null;
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
        results = await pipeline.exec();
      } catch {
        results = null;
      }

      const missing: number[] = [];
      if (results) {
        for (let i = 0; i < list.length; i++) {
          const [err, val] = results[i];
          if (!err && val !== null && val !== undefined) {
            list[i].unreadCount = parseInt(val as string, 10) || 0;
          } else {
            missing.push(i);
          }
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
      } else {
        for (let i = 0; i < list.length; i++) {
          missing.push(i);
        }
      }

      if (missing.length > 0) {
        const counts = await Promise.all(
          missing.map((i) => this.rebuildUnread(userId, list[i].id)),
        );
        missing.forEach((idx, j) => {
          list[idx].unreadCount = counts[j];
        });
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
    if (conv.kind === "DIRECT" && conv.partner) {
      await this.friendService.assertCanChat(userId, conv.partner.id);
    }

    // Enrich with unreadCount and presence from Redis
    if (this.redis) {
      let results: [Error | null, unknown][] | null = null;
      try {
        const pipeline = this.redis.pipeline();
        pipeline.get(unreadCountKey(userId, conversationId));
        if (conv.partner) {
          pipeline.get(presenceUserKey(conv.partner.id));
        }
        results = await pipeline.exec();
      } catch {
        results = null;
      }

      const [errCount, valCount] = results?.[0] ?? [null, null];
      if (!errCount && valCount !== null && valCount !== undefined) {
        conv.unreadCount = parseInt(valCount as string, 10) || 0;
      } else {
        conv.unreadCount = await this.rebuildUnread(userId, conversationId);
      }

      if (results && conv.partner && results.length > 1) {
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

    return toConversationResponse(conv);
  }

  private async rebuildUnread(userId: string, conversationId: string): Promise<number> {
    try {
      const count = await this.convRepo.countUnread(conversationId, userId);
      if (this.redis) {
        try {
          await this.redis.set(
            unreadCountKey(userId, conversationId),
            String(count),
            "EX",
            UNREAD_TTL_SECONDS,
          );
        } catch {
          // Best-effort cache write — the DB count is still returned to the caller.
        }
      }
      return count;
    } catch (err) {
      this.logger.warn("Failed to rebuild unread count from the database", {
        conversationId,
        err,
      });
      return 0;
    }
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

    const messageBelongsToConversation = await this.convRepo.isMessageInConversation(
      conversationId,
      lastReadMessageId,
    );
    if (!messageBelongsToConversation) {
      throw new BusinessError("BAD_REQUEST");
    }

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
