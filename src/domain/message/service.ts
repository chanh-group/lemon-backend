import { Inject, Injectable, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { MESSAGE_REPOSITORY, type MessageRepository } from "./repository.js";
import type { Message } from "./schema.js";
import type { SendMessageDto } from "./dto/request.js";
import type {
  MessageReactionSummary,
  MessageResponse,
  MessageTimelineResponse,
  ReplyTargetResponse,
} from "./dto/response.js";
import { toMessageResponseAsync, toMessageTimelineAsync } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";
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

@Injectable()
export class MessageService {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepo: MessageRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly convRepo: ConversationRepository,
    private readonly friendService: FriendService,
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: StorageService,
  ) {}

  private replyTarget(message: Message): ReplyTargetResponse {
    return {
      id: message.id,
      senderId: message.senderId,
      kind: message.kind,
      body: message.deletedAt ? null : message.body,
      deletedAt: message.deletedAt,
      storyPreview: message.deletedAt ? null : message.storyPreview,
    };
  }

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
      if (reply.deletedAt) throw new BusinessError("MESSAGE_REVOKED");
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
    if (message.replyToId) {
      const target = await this.messageRepo.findById(message.replyToId, false);
      response.replyTarget =
        target && target.conversationId === conversationId ? this.replyTarget(target) : null;
    }

    if (isNew) {
      // Emit realtime event to the conversation room
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

    const timeline = await this.messageRepo.findTimeline(conversationId, cursor, limit, after);
    const response = await toMessageTimelineAsync(timeline, this.storage);
    const ids = [
      ...new Set(timeline.items.flatMap((item) => (item.replyToId ? [item.replyToId] : []))),
    ];
    if (ids.length) {
      const targets = await this.messageRepo.findReplyTargets(conversationId, ids);
      const byId = new Map(targets.map((target) => [target.id, target]));
      for (const item of response.items) {
        if (item.replyToId) {
          const target = byId.get(item.replyToId);
          item.replyTarget = target ? this.replyTarget(target) : null;
        }
      }
    }
    return response;
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
