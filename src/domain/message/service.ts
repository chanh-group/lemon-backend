import { Inject, Injectable, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
  type ReplyTargetMessage,
} from "./repository.js";
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

  private replyTarget(message: ReplyTargetMessage): ReplyTargetResponse {
    return {
      id: message.id,
      senderId: message.senderId,
      kind: message.kind,
      body: message.deletedAt ? null : message.body,
      deletedAt: message.deletedAt,
      storyPreview: message.deletedAt ? null : message.storyPreview,
    };
  }

  private async attachSender<T extends MessageResponse>(response: T): Promise<T> {
    const [sender] = await this.messageRepo.findSenderProfiles([response.senderId]);
    if (sender) response.sender = sender;
    return response;
  }

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
    story?: StoryReplyRef,
  ): Promise<MessageResponse> {
    // 1. Verify that sender is a member of this conversation (NOT_PARTICIPANT)
    //    and resolve the direct partner for the friendship gate.
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
        if (
          !(await this.convRepo.canAccessMessage(
            sourceMessage.conversationId,
            senderId,
            sourceMessage.id,
          ))
        )
          throw new BusinessError("MESSAGE_NOT_FOUND");
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

    const storage = this.storage;
    if (attachments?.length && !storage) throw new BusinessError("OBJECT_NOT_UPLOADED");
    for (const attachment of attachments ?? []) {
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
      if (!isValidKey) throw new BusinessError("INVALID_OBJECT_KEY");
    }

    const replyPromise = dto.replyToId
      ? this.messageRepo.findById(dto.replyToId, false)
      : Promise.resolve(null);
    const attachmentChecks = (attachments ?? []).map(async (attachment) => {
      const object = await storage!.headObject(attachment.objectKey);
      if (!object) throw new BusinessError("OBJECT_NOT_UPLOADED");
      if (object.contentLength !== attachment.sizeBytes) {
        throw new BusinessError("INVALID_OBJECT_KEY");
      }
    });
    const [reply] = await Promise.all([replyPromise, Promise.all(attachmentChecks)]);

    if (dto.replyToId) {
      if (
        !reply ||
        reply.conversationId !== conversationId ||
        !(await this.convRepo.canAccessMessage(conversationId, senderId, reply.id))
      ) {
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

    const [mapped, target] = await Promise.all([
      toMessageResponseAsync(message, this.storage, senderId),
      message.replyToId
        ? this.messageRepo.findById(message.replyToId, false)
        : Promise.resolve(null),
    ]);
    const response = await this.attachSender(mapped);
    if (message.replyToId) {
      if (
        target &&
        target.conversationId === conversationId &&
        (await this.convRepo.canAccessMessage(conversationId, senderId, target.id))
      ) {
        const replyTarget = this.replyTarget(target);
        const [replySender] = await this.messageRepo.findSenderProfiles([target.senderId]);
        if (replySender) replyTarget.sender = replySender;
        response.replyTarget = replyTarget;
      } else response.replyTarget = null;
    }

    if (isNew) {
      // replyTarget is viewer-dependent: a user can hide a message locally or
      // be below the group's history boundary. Never broadcast an enriched
      // payload to a shared conversation room.
      const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
      const replyVisibleTo = response.replyToId
        ? new Set(
            await this.convRepo.getMessageRecipientUserIds(conversationId, response.replyToId),
          )
        : null;
      const recipientPayloads = participantIds.map((participantId) => ({
        userId: participantId,
        payload:
          !response.replyToId || replyVisibleTo?.has(participantId)
            ? response
            : { ...response, replyTarget: null },
      }));
      this.realtimeService.emitNewMessage(conversationId, response, recipientPayloads);
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
    const [, cursorInConversation, afterInConversation] = await Promise.all([
      this.assertDirectConversationAllowed(conversationId, userId),
      cursor
        ? this.convRepo.canAccessMessage(conversationId, userId, cursor)
        : Promise.resolve(true),
      after ? this.convRepo.canAccessMessage(conversationId, userId, after) : Promise.resolve(true),
    ]);
    if (!cursorInConversation || !afterInConversation) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }

    const timeline = await this.messageRepo.findTimeline(
      conversationId,
      userId,
      cursor,
      limit,
      after,
    );
    if (timeline.authorized === false) throw new BusinessError("NOT_PARTICIPANT");
    const ids = [
      ...new Set(timeline.items.flatMap((item) => (item.replyToId ? [item.replyToId] : []))),
    ];
    const [response, senderProfiles, targets] = await Promise.all([
      toMessageTimelineAsync(timeline, this.storage, userId),
      this.messageRepo.findSenderProfiles(timeline.items.map(({ senderId }) => senderId)),
      ids.length
        ? this.messageRepo.findReplyTargets(conversationId, ids, userId)
        : Promise.resolve([]),
    ]);
    const sendersById = new Map(senderProfiles.map((sender) => [sender.id, sender]));
    for (const message of response.items) message.sender = sendersById.get(message.senderId);
    if (ids.length) {
      const byId = new Map(targets.map((target) => [target.id, target]));
      const targetSenders = await this.messageRepo.findSenderProfiles(
        targets.map(({ senderId }) => senderId),
      );
      const targetSendersById = new Map(targetSenders.map((sender) => [sender.id, sender]));
      for (const item of response.items) {
        if (item.replyToId) {
          const target = byId.get(item.replyToId);
          if (target) {
            const replyTarget = this.replyTarget(target);
            const sender = targetSendersById.get(target.senderId);
            if (sender) replyTarget.sender = sender;
            item.replyTarget = replyTarget;
          } else item.replyTarget = null;
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
    const msg = await this.messageRepo.findById(messageId, false);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    const directPartnerId = await this.assertDirectConversationAllowed(msg.conversationId, userId);
    if (!(await this.convRepo.canAccessMessage(msg.conversationId, userId, msg.id)))
      throw new BusinessError("MESSAGE_NOT_FOUND");

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

    const response = await this.attachSender(await toMessageResponseAsync(updated, this.storage));
    const recipientUserIds = directPartnerId
      ? undefined
      : await this.getVisibleGroupRecipients(response.conversationId, response.id);
    this.realtimeService.emitMessageUpdated(response.conversationId, response, recipientUserIds);
    return response;
  }

  async revokeMessage(userId: string, messageId: string): Promise<MessageResponse> {
    const msg = await this.messageRepo.findById(messageId, false);
    if (!msg) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    const directPartnerId = await this.assertDirectConversationAllowed(msg.conversationId, userId);
    if (!(await this.convRepo.canAccessMessage(msg.conversationId, userId, msg.id)))
      throw new BusinessError("MESSAGE_NOT_FOUND");

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

    const response = await this.attachSender(await toMessageResponseAsync(revoked, this.storage));
    const recipientUserIds = directPartnerId
      ? undefined
      : await this.getVisibleGroupRecipients(response.conversationId, response.id);
    this.realtimeService.emitMessageRevoked(
      response.conversationId,
      { id: response.id, deletedAt: response.deletedAt! },
      recipientUserIds,
    );
    return response;
  }

  async hideMessageForMe(userId: string, messageId: string): Promise<void> {
    // The repository checks current membership and history inside the write
    // transaction. A hidden message must remain eligible for an idempotent retry.
    const result = await this.messageRepo.hideForUser(messageId, userId);
    if (result.inserted)
      this.realtimeService.emitMessageHidden(userId, result.conversationId, messageId);
  }

  async reactToMessage(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ messageId: string; reactions: MessageReactionSummary[] }> {
    const message = await this.messageRepo.findById(messageId, false);
    if (!message || message.deletedAt) throw new BusinessError("MESSAGE_NOT_FOUND");
    const partnerId = await this.assertDirectConversationAllowed(message.conversationId, userId);
    if (!(await this.convRepo.canAccessMessage(message.conversationId, userId, message.id)))
      throw new BusinessError("MESSAGE_NOT_FOUND");
    const result = await this.messageRepo.reactMessage(userId, messageId, emoji);
    const { reactions, conversationId } = result;
    const recipientUserIds = partnerId
      ? undefined
      : await this.getVisibleGroupRecipients(conversationId, messageId);
    this.realtimeService.emitMessageReaction(
      conversationId,
      { messageId, userId, emoji, reactions },
      recipientUserIds,
    );
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

  private async getVisibleGroupRecipients(
    conversationId: string,
    messageId: string,
  ): Promise<string[]> {
    return this.convRepo.getMessageRecipientUserIds(conversationId, messageId);
  }
}
