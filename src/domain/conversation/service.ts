import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CursorPage } from "../shared.js";
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
import { RealtimeService } from "../realtime/service.js";
import type { ConversationResponse } from "./dto/response.js";
import type { ConversationMemberResponse } from "./dto/response.js";
import { toConversationResponse } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";
import { SystemError } from "../../utils/errors/system.js";
import { RedisHealthService } from "../../configs/redis-health.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import { DEFAULT_PAGE_SIZE } from "../pagination.constants.js";
import {
  GROUP_MAX_MEMBERS,
  GROUP_MAX_NAME_LENGTH,
  GROUP_MIN_INVITED_MEMBERS,
} from "./constants.js";

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

type ReadOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settleRead<T>(read: Promise<T>): Promise<ReadOutcome<T>> {
  try {
    return { ok: true, value: await read };
  } catch (error) {
    return { ok: false, error };
  }
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
  private readonly unreadRebuildsInFlight = new Map<string, Promise<Map<string, number>>>();

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

    const [targetUser, canChat, existing] = await Promise.all([
      settleRead(this.userRepo.findById(targetUserId)),
      settleRead(this.friendService.assertCanChat(userId, targetUserId)),
      settleRead(this.convRepo.findDirectByParticipants(userId, targetUserId)),
    ]);

    // Surface failures in the historical sequential order when several reads fail at once.
    if (!targetUser.ok) throw targetUser.error;
    if (!targetUser.value) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    if (!canChat.ok) throw canChat.error;
    if (!existing.ok) throw existing.error;

    const conversation =
      existing.value ?? (await this.convRepo.createDirectConversation(userId, targetUserId));

    this.joinParticipantsBestEffort(conversation.id, [userId, targetUserId]);

    return toConversationResponse(conversation);
  }

  async createGroup(
    userId: string,
    input: { title: string; memberIds: string[]; clientRequestId: string },
  ): Promise<ConversationResponse> {
    if (
      input.title.trim().length < 1 ||
      input.title.trim().length > GROUP_MAX_NAME_LENGTH ||
      input.memberIds.length < GROUP_MIN_INVITED_MEMBERS ||
      input.memberIds.length > GROUP_MAX_MEMBERS - 1 ||
      new Set(input.memberIds).size !== input.memberIds.length ||
      input.memberIds.includes(userId)
    ) {
      throw new BusinessError("BAD_REQUEST");
    }
    const createRequestHash = createHash("sha256")
      .update(JSON.stringify({ title: input.title.trim(), memberIds: [...input.memberIds].sort() }))
      .digest("hex");
    const existing = await this.convRepo.findGroupCreateRequest(userId, input.clientRequestId);
    const replayExisting = async (match: typeof existing) => {
      if (!match) return null;
      if (match.deletedAt || match.createRequestHash !== createRequestHash) {
        throw new BusinessError("CONFLICT");
      }
      const conversation = await this.convRepo.findById(match.id, userId);
      if (!conversation) throw new BusinessError("NOT_PARTICIPANT");
      return toConversationResponse(conversation);
    };
    const replay = await replayExisting(existing);
    if (replay) return replay;

    const replayAfterValidationRace = async () => {
      const raced = await this.convRepo.findGroupCreateRequest(userId, input.clientRequestId);
      return replayExisting(raced);
    };

    const [creator, users, accepted] = await Promise.all([
      this.userRepo.findById(userId),
      this.userRepo.findByIds(input.memberIds),
      this.friendService.findAcceptedFriendIds(userId, input.memberIds),
    ]);
    if (!creator) {
      const raced = await replayAfterValidationRace();
      if (raced) return raced;
      throw new BusinessError("USER_NOT_FOUND");
    }
    if (users.length !== input.memberIds.length || users.some((user) => !user.isActive)) {
      const raced = await replayAfterValidationRace();
      if (raced) return raced;
      throw new BusinessError("USER_NOT_FOUND");
    }
    if (accepted.size !== input.memberIds.length) {
      const raced = await replayAfterValidationRace();
      if (raced) return raced;
      throw new BusinessError("FRIENDSHIP_REQUIRED");
    }
    const result = await this.convRepo.createGroup({
      creatorId: userId,
      ...input,
      title: input.title.trim(),
      createRequestHash,
    });
    if (result.created) {
      const participantIds = await this.convRepo.getParticipantUserIds(result.conversation.id);
      this.realtimeService.emitGroupEvent(participantIds, "conversation:created", {
        conversationId: result.conversation.id,
      });
    }
    return toConversationResponse(result.conversation);
  }

  async listGroupMembers(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMemberResponse[]> {
    await this.requireGroupMember(conversationId, userId);
    return this.convRepo.listMembers(conversationId);
  }

  private async requireGroupMember(conversationId: string, userId: string) {
    const group = await this.convRepo.findById(conversationId, userId);
    if (!group) throw new BusinessError("NOT_PARTICIPANT");
    if (group.kind !== "GROUP") throw new BusinessError("BAD_REQUEST");
    return group;
  }

  private async requireGroupManager(conversationId: string, userId: string) {
    const group = await this.requireGroupMember(conversationId, userId);
    if (group.myRole !== "ADMIN") {
      throw new BusinessError("FORBIDDEN");
    }
    return group;
  }

  async addGroupMembers(conversationId: string, actorId: string, memberIds: string[]) {
    await this.requireGroupManager(conversationId, actorId);
    if (new Set(memberIds).size !== memberIds.length) throw new BusinessError("BAD_REQUEST");
    const accepted = await this.friendService.findAcceptedFriendIds(actorId, memberIds);
    if (accepted.size !== memberIds.length) throw new BusinessError("FRIENDSHIP_REQUIRED");
    const users = await this.userRepo.findByIds(memberIds);
    if (users.length !== memberIds.length || users.some((user) => !user.isActive)) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    await this.convRepo.addGroupMembers(conversationId, actorId, memberIds);
    const userIds = await this.convRepo.getParticipantUserIds(conversationId);
    this.realtimeService.emitGroupEvent(userIds, "conversation:updated", { conversationId });
    this.realtimeService.emitGroupEvent(userIds, "member:added", { conversationId, memberIds });
    return this.getById(conversationId, actorId);
  }

  async removeGroupMember(
    conversationId: string,
    actorId: string,
    targetId: string,
  ): Promise<void> {
    await this.requireGroupManager(conversationId, actorId);
    if (actorId === targetId) throw new BusinessError("BAD_REQUEST");
    const target = await this.convRepo.getGroupMembership(conversationId, targetId);
    if (!target) throw new BusinessError("FORBIDDEN");
    await this.convRepo.removeGroupMember(conversationId, actorId, targetId);
    this.realtimeService.leaveConversation([targetId], conversationId);
    this.realtimeService.emitGroupEvent([targetId], "member:removed", {
      conversationId,
      userId: targetId,
      removedBy: actorId,
    });
    this.realtimeService.emitGroupEvent(
      await this.convRepo.getParticipantUserIds(conversationId),
      "conversation:updated",
      { conversationId },
    );
  }

  async updateGroupTitle(conversationId: string, actorId: string, title: string): Promise<void> {
    await this.requireGroupManager(conversationId, actorId);
    await this.convRepo.updateGroup(conversationId, actorId, title);
    const memberIds = await this.convRepo.getParticipantUserIds(conversationId);
    this.realtimeService.emitGroupEvent(memberIds, "conversation:updated", { conversationId });
  }

  async updateGroupAvatar(
    conversationId: string,
    actorId: string,
    avatarUrl: string,
  ): Promise<void> {
    await this.requireGroupManager(conversationId, actorId);
    await this.convRepo.updateGroupAvatar(conversationId, actorId, avatarUrl);
    try {
      const memberIds = await this.convRepo.getParticipantUserIds(conversationId);
      this.realtimeService.emitGroupEvent(memberIds, "conversation:updated", { conversationId });
    } catch (err) {
      this.logger.warn("Group avatar saved but realtime notification failed", {
        err,
        conversationId,
      });
    }
  }

  async updateGroupRole(
    conversationId: string,
    actorId: string,
    targetId: string,
    role: "ADMIN" | "MEMBER",
  ) {
    await this.requireGroupManager(conversationId, actorId);
    if (actorId === targetId || !(await this.convRepo.getGroupMembership(conversationId, targetId)))
      throw new BusinessError("BAD_REQUEST");
    await this.convRepo.updateMemberRole(conversationId, actorId, targetId, role);
    this.realtimeService.emitGroupEvent(
      await this.convRepo.getParticipantUserIds(conversationId),
      "member:role-changed",
      { conversationId, userId: targetId, role },
    );
  }

  async leaveGroup(conversationId: string, userId: string) {
    const result = await this.convRepo.leaveGroup(conversationId, userId);
    this.realtimeService.leaveConversation([userId], conversationId);
    this.realtimeService.emitGroupEvent([userId], "member:removed", {
      conversationId,
      userId,
      left: true,
    });
    this.realtimeService.emitGroupEvent(
      await this.convRepo.getParticipantUserIds(conversationId),
      "conversation:updated",
      { conversationId },
    );
    return result;
  }

  async disbandGroup(conversationId: string, actorId: string): Promise<void> {
    const memberIds = await this.convRepo.disbandGroup(conversationId, actorId);
    this.realtimeService.leaveConversation(memberIds, conversationId);
    this.realtimeService.emitGroupEvent(memberIds, "conversation:disbanded", { conversationId });
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
        const counts = await this.rebuildUnreadBatch(list, userId);
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
        const counts = await this.rebuildUnreadBatch(
          missing.map((i) => list[i]),
          userId,
        );
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
    conversations: ConversationWithPartner[],
    userId: string,
  ): Promise<Map<string, number>> {
    const conversationIds = conversations.map((conversation) => conversation.id);
    const key = JSON.stringify([
      userId,
      conversations
        .map((conversation) => [
          conversation.id,
          conversation.unreadRevision,
          conversation.lastReadMessageId ?? null,
        ])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ]);
    const inFlight = this.unreadRebuildsInFlight.get(key);
    if (inFlight) return inFlight;
    const pending = this.countUnreadFromDatabase(conversationIds, userId).finally(() => {
      this.unreadRebuildsInFlight.delete(key);
    });
    this.unreadRebuildsInFlight.set(key, pending);
    return pending;
  }

  private async countUnreadFromDatabase(
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
    if (!(await this.convRepo.canAccessMessage(conversationId, userId, lastReadMessageId))) {
      throw new BusinessError("BAD_REQUEST");
    }

    await this.convRepo.updateLastRead(conversationId, userId, lastReadMessageId);

    // Broadcast to room
    const recipientUserIds =
      conversation.kind === "GROUP"
        ? await this.convRepo.getMessageRecipientUserIds(conversationId, lastReadMessageId)
        : undefined;
    this.realtimeService.emitReadUpdated(
      conversationId,
      { userId, lastReadMessageId, readAt: new Date() },
      recipientUserIds,
    );
  }
}
