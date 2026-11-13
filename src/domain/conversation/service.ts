import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
  type ConversationWithPartner,
} from "./repository.js";
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

function parseUnreadCount(value: unknown, conversation: ConversationWithPartner): number | null {
  if (typeof value !== "string" || conversation.unreadRevision === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("revision" in parsed) ||
      !("lastRead" in parsed) ||
      !("count" in parsed)
    )
      return null;
    if (
      parsed.revision !== conversation.unreadRevision ||
      parsed.lastRead !== (conversation.lastReadMessageId ?? null)
    )
      return null;
    return typeof parsed.count === "number" &&
      Number.isSafeInteger(parsed.count) &&
      parsed.count >= 0
      ? parsed.count
      : null;
  } catch {
    return null;
  }
}

function serializeUnreadCount(conversation: ConversationWithPartner, count: number): string {
  return JSON.stringify({
    revision: conversation.unreadRevision,
    lastRead: conversation.lastReadMessageId ?? null,
    count,
  });
}

function isOnlinePresence(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "state" in parsed &&
      parsed.state === "online"
    );
  } catch {
    return false;
  }
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
            const parsed = parseUnreadCount(val, list[i]);
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
            list[i].partner!.isOnline = !err && isOnlinePresence(val);
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
        await this.cacheUnreadCounts(
          userId,
          missing.map((i) => list[i]),
          counts,
        );
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
      conv.unreadCount = await this.rebuildUnread(userId, conv);
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
        const parsed = parseUnreadCount(valCount, conv);
        if (parsed !== null) {
          conv.unreadCount = parsed;
          this.metrics?.recordLookup("unread", "hit");
        } else {
          this.metrics?.recordLookup("unread", "miss");
          conv.unreadCount = await this.rebuildUnread(userId, conv);
        }
      } else {
        this.metrics?.recordLookup("unread", "miss");
        conv.unreadCount = await this.rebuildUnread(userId, conv);
      }

      if (results && conv.partner && results.length > 1) {
        const [errPres, valPres] = results[1];
        conv.partner.isOnline = !errPres && isOnlinePresence(valPres);
      }
    }

    return toConversationResponse(conv);
  }

  private async rebuildUnread(
    userId: string,
    conversation: ConversationWithPartner,
  ): Promise<number> {
    const conversationId = conversation.id;
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
    if (this.redis && conversation.unreadRevision !== undefined) {
      try {
        await (this.metrics
          ? this.metrics.measure("unread_write", () =>
              this.redis!.set(
                unreadCountKey(userId, conversationId),
                serializeUnreadCount(conversation, count),
                "EX",
                UNREAD_TTL_SECONDS,
              ),
            )
          : this.redis.set(
              unreadCountKey(userId, conversationId),
              serializeUnreadCount(conversation, count),
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

  private async cacheUnreadCounts(
    userId: string,
    conversations: ConversationWithPartner[],
    counts: Map<string, number>,
  ): Promise<void> {
    const cacheable = conversations.filter(
      (conversation) => conversation.unreadRevision !== undefined,
    );
    if (!this.redis || cacheable.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const conversation of cacheable) {
        pipeline.set(
          unreadCountKey(userId, conversation.id),
          serializeUnreadCount(conversation, counts.get(conversation.id) ?? 0),
          "EX",
          UNREAD_TTL_SECONDS,
        );
      }
      const result = this.metrics
        ? await this.metrics.measure("unread_write", () => pipeline.exec())
        : await pipeline.exec();
      requireRedisPipelineResults(result, "unread cache pipeline", cacheable.length);
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

    const [exists, conversation] = await Promise.all([
      this.convRepo.existsById(conversationId),
      this.convRepo.findById(conversationId, userId),
    ]);
    if (!exists) throw new BusinessError("CONVERSATION_NOT_FOUND");
    if (!conversation) throw new BusinessError("NOT_PARTICIPANT");
    const [messageBelongsToConversation] = await Promise.all([
      this.convRepo.isMessageInConversation(conversationId, lastReadMessageId),
      conversation.kind === "DIRECT" && conversation.partner
        ? this.friendService.assertCanChat(userId, conversation.partner.id)
        : Promise.resolve(),
    ]);
    if (!messageBelongsToConversation) {
      throw new BusinessError("BAD_REQUEST");
    }

    await this.convRepo.updateLastRead(conversationId, userId, lastReadMessageId);

    // Broadcast to room
    this.realtimeService.emitReadUpdated(conversationId, {
      userId,
      lastReadMessageId,
      readAt: new Date(),
    });
  }
}
