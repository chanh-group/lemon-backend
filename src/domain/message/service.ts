import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { MESSAGE_REPOSITORY, type MessageRepository } from "./repository.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { UNREAD_TTL_SECONDS } from "../../utils/cache/constants.js";
import { unreadCountKey } from "../../utils/cache/keys.js";
import type { SendMessageDto } from "./dto/request.js";
import type { MessageResponse, MessageTimelineResponse } from "./dto/response.js";
import { toMessageResponse, toMessageTimeline } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";
import { SystemError } from "../../utils/errors/system.js";
import { RedisHealthService } from "../../configs/redis-health.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";

export type { SendMessageDto };

export const INCREMENT_UNREAD_WITH_TTL_LUA = `
  local value = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return value
`;

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepo: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    private readonly friendService: FriendService,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Optional() @Inject(RedisHealthService) private readonly redisHealth?: RedisHealthService,
    @Optional() @Inject(RedisMetricsService) private readonly metrics?: RedisMetricsService,
  ) {}

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponse> {
    // 1. Verify that sender is a member of this conversation
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(senderId)) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    const directPartnerId = await this.assertDirectConversationAllowed(conversationId, senderId);

    if ((!dto.kind || dto.kind === "TEXT") && (!dto.body || dto.body.trim().length === 0)) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (dto.body && dto.body.length > 4000) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (dto.replyToId) {
      const reply = await this.messageRepo.findById(dto.replyToId);
      if (!reply || reply.conversationId !== conversationId) {
        throw new BusinessError("BAD_REQUEST");
      }
    }

    // 2. Persist message in PostgreSQL with transaction
    const { message, isNew } = await this.messageRepo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: dto.body,
      kind: dto.kind ?? "TEXT",
      clientMsgId: dto.clientMsgId,
      replyToId: dto.replyToId,
      ...(directPartnerId
        ? { requiredFriendship: { userAId: senderId, userBId: directPartnerId } }
        : {}),
    });

    const response = toMessageResponse(message);

    if (isNew) {
      const recipientIds = participantIds.filter((id) => id !== senderId);

      // 3. Atomically increment unread counter in Redis for recipients
      if (this.redis && recipientIds.length > 0) {
        try {
          const pipeline = this.redis.pipeline();
          for (const recipientId of recipientIds) {
            pipeline.eval(
              INCREMENT_UNREAD_WITH_TTL_LUA,
              1,
              unreadCountKey(recipientId, conversationId),
              UNREAD_TTL_SECONDS,
            );
          }
          const results = await (this.metrics
            ? this.metrics.measure("unread_write", () => pipeline.exec())
            : pipeline.exec());
          if (!results || results.length !== recipientIds.length || results.some(([err]) => err)) {
            throw new SystemError("unavailable", "Redis unread counter pipeline failed", {
              cause: results?.find(([err]) => err)?.[0],
            });
          }
        } catch (err) {
          this.redisHealth?.markUnavailable(err);
          this.logger.error("Message persisted but Redis unread counter update failed", {
            conversationId,
            messageId: response.id,
            err,
          });
          // The PostgreSQL insert already committed; the outer emit still delivers it.
        }
      }

      // 4. Emit realtime event to the conversation room
      this.realtimeService.emitNewMessage(conversationId, response);
    }

    return response;
  }

  async getTimeline(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
    after?: string,
  ): Promise<MessageTimelineResponse> {
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(userId)) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    await this.assertDirectConversationAllowed(conversationId, userId);

    return toMessageTimeline(
      await this.messageRepo.findTimeline(conversationId, cursor, limit, after),
    );
  }

  private async assertDirectConversationAllowed(
    conversationId: string,
    userId: string,
  ): Promise<string | undefined> {
    const conversation = await this.convRepo.findById(conversationId, userId);
    if (!conversation) throw new BusinessError("NOT_PARTICIPANT");
    if (conversation.kind === "DIRECT" && conversation.partner) {
      await this.friendService.assertCanChat(userId, conversation.partner.id);
      return conversation.partner.id;
    }
    return undefined;
  }

  async editMessage(userId: string, messageId: string, body: string): Promise<MessageResponse> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    await this.assertDirectConversationAllowed(msg.conversationId, userId);

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
      return await this.resolveWriteMiss(messageId, userId, msg.conversationId);
    }

    const response = toMessageResponse(updated);
    this.realtimeService.emitMessageUpdated(response.conversationId, response);
    return response;
  }

  async revokeMessage(userId: string, messageId: string): Promise<MessageResponse> {
    const msg = await this.messageRepo.findById(messageId);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    await this.assertDirectConversationAllowed(msg.conversationId, userId);

    if (msg.deletedAt) {
      throw new BusinessError("MESSAGE_REVOKED");
    }

    if (msg.senderId !== userId) {
      throw new BusinessError("FORBIDDEN");
    }

    const revoked = await this.messageRepo.softDelete(messageId, userId);
    if (!revoked) {
      return await this.resolveWriteMiss(messageId, userId, msg.conversationId);
    }

    const response = toMessageResponse(revoked);
    this.realtimeService.emitMessageRevoked(response.conversationId, {
      id: response.id,
      deletedAt: response.deletedAt!,
    });
    return response;
  }

  private async resolveWriteMiss(
    messageId: string,
    userId: string,
    conversationId: string,
  ): Promise<MessageResponse> {
    const missed = await this.messageRepo.resolveWriteMiss(messageId, userId, conversationId);
    if (!missed) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    return toMessageResponse(missed);
  }
}
