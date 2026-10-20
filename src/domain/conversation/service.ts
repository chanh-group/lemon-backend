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
import { SystemError } from "../../utils/errors/system.js";
import { RedisHealthService } from "../../configs/redis-health.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import type { CursorPage } from "../shared.js";
import { DEFAULT_PAGE_SIZE } from "../pagination.constants.js";

function requireRedisPipelineResults(
  results: [Error | null, unknown][] | null,
  operation: string,
  expectedLength?: number,
): [Error | null, unknown][] {
  if (
    !results ||
    (expectedLength !== undefined && results.length !== expectedLength) ||
    results.some((row) => !Array.isArray(row) || row.length < 2)
  ) {
    throw new SystemError("unavailable", `Redis ${operation} returned no result`);
  }
  const commandError = results.find(([err]) => err)?.[0];
  if (commandError) {
    throw new SystemError("unavailable", `Redis ${operation} failed`, { cause: commandError });
  }
  return results;
}

function parseUnreadCount(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    private readonly friendService: FriendService,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Optional() @Inject(RedisHealthService) private readonly redisHealth?: RedisHealthService,
    @Optional() @Inject(RedisMetricsService) private readonly metrics?: RedisMetricsService,
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

  async listConversations(
    userId: string,
    limit = DEFAULT_PAGE_SIZE,
    cursor?: string,
  ): Promise<CursorPage<ConversationResponse>> {
    const page = await this.convRepo.findUserConversations(userId, limit, cursor);
    const conversations = page.items;
    const candidateFriendIds = conversations.flatMap((conversation) =>
      conversation.kind === "DIRECT" && conversation.partner ? [conversation.partner.id] : [],
    );
    const friendIds = await this.friendService.findAcceptedFriendIds(userId, candidateFriendIds);
    const list = conversations.filter(
      (conversation) =>
        conversation.kind !== "DIRECT" ||
        Boolean(conversation.partner && friendIds.has(conversation.partner.id)),
    );

    if (list.length === 0) return { ...page, items: [] };

    // Enrich with unread counts and presence from Redis
    if (list.length > 0) {
      if (!this.redis) {
        const counts = await this.rebuildUnreadBatch(
          list.map((conv) => conv.id),
          userId,
        );
        for (const conv of list) conv.unreadCount = counts.get(conv.id) ?? 0;
        return { ...page, items: list.map(toConversationResponse) };
      }

      let results: [Error | null, unknown][] | null;
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
        results = await (this.metrics
          ? this.metrics.measure("unread_read", () => pipeline.exec())
          : pipeline.exec());
      } catch (err) {
        this.redisHealth?.markUnavailable(err);
        throw new SystemError("unavailable", "Redis conversation list query failed", {
          cause: err,
        });
      }
      results = requireRedisPipelineResults(
        results,
        "conversation list query",
        list.length + list.filter((conversation) => conversation.partner).length,
      );

      const missing: number[] = [];
      if (results) {
        for (let i = 0; i < list.length; i++) {
          const [err, val] = results[i];
          if (!err && val !== null && val !== undefined) {
            const parsed = parseUnreadCount(val);
            if (parsed !== null) {
              list[i].unreadCount = parsed;
              this.metrics?.recordLookup("unread", "hit");
            } else {
              missing.push(i);
              this.metrics?.recordLookup("unread", "miss");
            }
          } else {
            missing.push(i);
            this.metrics?.recordLookup("unread", "miss");
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
        const conversationIds = missing.map((i) => list[i].id);
        const counts = await this.rebuildUnreadBatch(conversationIds, userId);
        await this.cacheUnreadCounts(userId, counts);
        missing.forEach((idx) => {
          list[idx].unreadCount = counts.get(list[idx].id) ?? 0;
        });
      }
    }

    return { ...page, items: list.map(toConversationResponse) };
  }

  async getById(conversationId: string, userId: string): Promise<ConversationResponse> {
    const [exists, conv] = await Promise.all([
      this.convRepo.existsById(conversationId),
      this.convRepo.findById(conversationId, userId),
    ]);
    if (!exists) {
      throw new BusinessError("CONVERSATION_NOT_FOUND");
    }
    if (!conv) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    if (conv.kind === "DIRECT" && conv.partner) {
      await this.friendService.assertCanChat(userId, conv.partner.id);
    }

    // Enrich with unreadCount and presence from Redis
    if (!this.redis) {
      conv.unreadCount = await this.rebuildUnread(userId, conversationId);
    }
    if (this.redis) {
      let results: [Error | null, unknown][] | null;
      try {
        const pipeline = this.redis.pipeline();
        pipeline.get(unreadCountKey(userId, conversationId));
        if (conv.partner) {
          pipeline.get(presenceUserKey(conv.partner.id));
        }
        results = await (this.metrics
          ? this.metrics.measure("unread_read", () => pipeline.exec())
          : pipeline.exec());
      } catch (err) {
        this.redisHealth?.markUnavailable(err);
        throw new SystemError("unavailable", "Redis conversation query failed", { cause: err });
      }
      results = requireRedisPipelineResults(results, "conversation query", conv.partner ? 2 : 1);

      const [errCount, valCount] = results?.[0] ?? [null, null];
      if (!errCount && valCount !== null && valCount !== undefined) {
        const parsed = parseUnreadCount(valCount);
        if (parsed !== null) {
          conv.unreadCount = parsed;
          this.metrics?.recordLookup("unread", "hit");
        } else {
          this.metrics?.recordLookup("unread", "miss");
          conv.unreadCount = await this.rebuildUnread(userId, conversationId);
        }
      } else {
        this.metrics?.recordLookup("unread", "miss");
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
    let count: number;
    try {
      count = await this.convRepo.countUnread(conversationId, userId);
    } catch (err) {
      this.logger.warn("Failed to rebuild unread count from the database", {
        conversationId,
        err,
      });
      throw new SystemError("database", "Unread count query failed", { cause: err });
    }
    if (this.redis) {
      try {
        await (this.metrics
          ? this.metrics.measure("unread_write", () =>
              this.redis!.set(
                unreadCountKey(userId, conversationId),
                String(count),
                "EX",
                UNREAD_TTL_SECONDS,
              ),
            )
          : this.redis.set(
              unreadCountKey(userId, conversationId),
              String(count),
              "EX",
              UNREAD_TTL_SECONDS,
            ));
      } catch (err) {
        this.redisHealth?.markUnavailable(err);
        throw new SystemError("unavailable", "Redis unread cache write failed", { cause: err });
      }
    }
    return count;
  }

  private async cacheUnreadCounts(userId: string, counts: Map<string, number>): Promise<void> {
    if (!this.redis || counts.size === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const [conversationId, count] of counts) {
        pipeline.set(
          unreadCountKey(userId, conversationId),
          String(count),
          "EX",
          UNREAD_TTL_SECONDS,
        );
      }
      const result = this.metrics
        ? await this.metrics.measure("unread_write", () => pipeline.exec())
        : await pipeline.exec();
      requireRedisPipelineResults(result, "unread cache pipeline", counts.size);
    } catch (err) {
      this.redisHealth?.markUnavailable(err);
      throw new SystemError("unavailable", "Redis unread cache pipeline failed", { cause: err });
    }
  }

  private async rebuildUnreadBatch(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    try {
      return await this.convRepo.countUnreadByConversationIds(conversationIds, userId);
    } catch (err) {
      this.logger.warn("Failed to rebuild unread counts from the database", { err });
      throw new SystemError("database", "Unread count query failed", { cause: err });
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
      } catch (err) {
        this.redisHealth?.markUnavailable(err);
        throw new SystemError("unavailable", "Redis unread reset failed", { cause: err });
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
