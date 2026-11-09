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
import type {
  MessageReactionSummary,
  MessageResponse,
  MessageTimelineResponse,
} from "./dto/response.js";
import { toMessageResponseAsync, toMessageTimelineAsync } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";
import { SystemError } from "../../utils/errors/system.js";
import { RedisHealthService } from "../../configs/redis-health.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import { MESSAGE_MAX_BODY_LENGTH } from "./constants.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import { CHAT_MAX_FILE_BYTES } from "../../utils/cache/constants.js";
import type { StoryPreview } from "../story/types.js";

function attachmentKindFromMessageKind(
  kind: SendMessageDto["kind"],
): "IMAGE" | "VIDEO" | "AUDIO" | "FILE" {
  switch (kind) {
    case "IMAGE":
    case "VIDEO":
    case "AUDIO":
    case "FILE":
      return kind;
    default:
      return "FILE";
  }
}

export type { SendMessageDto };

/**
 * Server-derived reference to the story a message quotes. Never accepted from
 * an HTTP body: the snapshot is captured by the story domain, so a client can
 * never attach a story (or a fabricated preview) it is not allowed to see.
 * The kind is decided here as well — the public API cannot ask for a
 * `STORY_REPLY` / `STORY_REACTION` message.
 */
export interface StoryReplyRef {
  kind: "STORY_REPLY" | "STORY_REACTION";
  storyId: string;
  storyPreview: StoryPreview;
}

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
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: StorageService,
  ) {}

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
    story?: StoryReplyRef,
  ): Promise<MessageResponse> {
    // 1. Verify that sender is a member of this conversation
    const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
    if (!participantIds.includes(senderId)) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    const directPartnerId = await this.assertDirectConversationAllowed(conversationId, senderId);

    let sourceMessage: Awaited<ReturnType<MessageRepository["findById"]>> = null;
    if (dto.isForwarded) {
      if (dto.sourceMessageId) {
        sourceMessage = await this.messageRepo.findById(dto.sourceMessageId);
      }
      if (!dto.sourceMessageId) throw new BusinessError("BAD_REQUEST");
      if (!sourceMessage) throw new BusinessError("MESSAGE_NOT_FOUND");
      if (sourceMessage) {
        await this.assertDirectConversationAllowed(sourceMessage.conversationId, senderId);
        if (sourceMessage.deletedAt) throw new BusinessError("MESSAGE_REVOKED");
        if (!["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE"].includes(sourceMessage.kind)) {
          throw new BusinessError("BAD_REQUEST");
        }
      }
    }

    const kind = sourceMessage ? (sourceMessage.kind as SendMessageDto["kind"]) : dto.kind;
    const body = sourceMessage ? (sourceMessage.body ?? undefined) : dto.body;
    const attachments = sourceMessage
      ? sourceMessage.attachments?.map((attachment) => ({
          objectKey: attachment.objectKey,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: Number(attachment.sizeBytes),
          kind: attachment.kind,
          width: attachment.width ?? undefined,
          height: attachment.height ?? undefined,
          durationMs: attachment.durationMs ?? undefined,
          checksum: attachment.checksum ?? undefined,
        }))
      : dto.attachments;
    const hasAttachments = Boolean(attachments && attachments.length > 0);
    if ((!kind || kind === "TEXT") && !hasAttachments && (!body || body.trim().length === 0)) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (body && body.length > MESSAGE_MAX_BODY_LENGTH) {
      throw new BusinessError("BAD_REQUEST");
    }

    if (kind !== "TEXT") {
      if (!hasAttachments || (body && body.trim().length > 0)) {
        throw new BusinessError("BAD_REQUEST");
      }
      if (attachments?.some((attachment) => attachment.kind && attachment.kind !== kind)) {
        throw new BusinessError("BAD_REQUEST");
      }
    }

    if (attachments?.length) {
      const storage = this.storage;
      if (!storage) throw new BusinessError("OBJECT_NOT_UPLOADED");
      await Promise.all(
        attachments.map(async (attachment) => {
          if (attachment.sizeBytes > CHAT_MAX_FILE_BYTES) {
            throw new BusinessError("FILE_TOO_LARGE", {
              maxMb: String(Math.floor(CHAT_MAX_FILE_BYTES / (1024 * 1024))),
            });
          }
          const isValidKey = sourceMessage
            ? sourceMessage.attachments?.some(
                (sourceAttachment) => sourceAttachment.objectKey === attachment.objectKey,
              )
            : attachment.objectKey.startsWith(`chat/${conversationId}/${senderId}/`);
          if (!isValidKey) {
            throw new BusinessError("INVALID_OBJECT_KEY");
          }
          const object = await storage.headObject(attachment.objectKey);
          if (!object) throw new BusinessError("OBJECT_NOT_UPLOADED");
          if (object.contentLength !== attachment.sizeBytes) {
            throw new BusinessError("INVALID_OBJECT_KEY");
          }
        }),
      );
    }

    if (dto.replyToId) {
      const reply = await this.messageRepo.findById(dto.replyToId);
      if (!reply || reply.conversationId !== conversationId) {
        throw new BusinessError("BAD_REQUEST");
      }
    }

    let bucket = "lemon-chat-storage";
    if (this.storage) {
      try {
        bucket = this.storage.getBucket();
      } catch {
        bucket = "lemon-chat-storage";
      }
    }

    const attachmentsToInsert = attachments?.map((att) => ({
      bucket,
      objectKey: att.objectKey,
      fileName: att.fileName,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      kind: att.kind ?? attachmentKindFromMessageKind(dto.kind),
      width: att.width,
      height: att.height,
      durationMs: att.durationMs,
      checksum: att.checksum,
    }));

    // 2. Persist message in PostgreSQL with transaction
    const { message, isNew } = await this.messageRepo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body,
      kind:
        story?.kind ??
        kind ??
        (hasAttachments && attachments?.[0]?.kind ? attachments[0].kind : "TEXT"),
      clientMsgId: dto.clientMsgId,
      replyToId: dto.replyToId,
      attachments: attachmentsToInsert,
      isForwarded: Boolean(sourceMessage || dto.isForwarded),
      ...(directPartnerId
        ? { requiredFriendship: { userAId: senderId, userBId: directPartnerId } }
        : {}),
      storyId: story?.storyId ?? null,
      storyPreview: story?.storyPreview ?? null,
    });

    const response = await toMessageResponseAsync(message, this.storage);

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
    await this.assertDirectConversationAllowed(conversationId, userId);
    if (
      (cursor && !(await this.convRepo.isMessageInConversation(conversationId, cursor))) ||
      (after && !(await this.convRepo.isMessageInConversation(conversationId, after)))
    ) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }

    return await toMessageTimelineAsync(
      await this.messageRepo.findTimeline(conversationId, cursor, limit, after),
      this.storage,
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

    if (body.length > MESSAGE_MAX_BODY_LENGTH) {
      throw new BusinessError("BAD_REQUEST");
    }

    const updated = await this.messageRepo.updateBody(messageId, userId, body);
    if (!updated) {
      return await this.resolveWriteMiss(messageId, userId, msg.conversationId);
    }

    const response = await toMessageResponseAsync(updated, this.storage);
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

    const response = await toMessageResponseAsync(revoked, this.storage);
    this.realtimeService.emitMessageRevoked(response.conversationId, {
      id: response.id,
      deletedAt: response.deletedAt!,
    });
    return response;
  }

  async reactToMessage(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ messageId: string; reactions: MessageReactionSummary[] }> {
    const message = await this.messageRepo.findById(messageId, false);
    if (!message || message.deletedAt) throw new BusinessError("MESSAGE_NOT_FOUND");
    const partnerId = await this.assertDirectConversationAllowed(message.conversationId, userId);
    const result = partnerId
      ? await this.messageRepo.reactMessage(userId, messageId, emoji, {
          userAId: userId,
          userBId: partnerId,
        })
      : await this.messageRepo.reactMessage(userId, messageId, emoji);
    const { reactions, conversationId } = result;
    this.realtimeService.emitMessageReaction(conversationId, {
      messageId,
      userId,
      emoji,
      reactions,
    });
    return { messageId, reactions };
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
    return await toMessageResponseAsync(missed, this.storage);
  }
}
