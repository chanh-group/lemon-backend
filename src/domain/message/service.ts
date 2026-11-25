import { Inject, Injectable, Optional } from "@nestjs/common";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { RealtimeService } from "../realtime/service.js";
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
  type MessageTimelineResult,
  type ReplyTargetMessage,
} from "./repository.js";
import type { SendMessageDto } from "./dto/request.js";
import type {
  MessageReactionSummary,
  MessageResponse,
  MessageTimelineResponse,
  MessageWindowResponse,
  ReplyContentCategory,
  ReplyTargetResponse,
} from "./dto/response.js";
import { toMessageResponseAsync, toMessageTimelineAsync } from "./dto/mapper.js";
import { FriendService } from "../friend/service.js";
import { ATTACHMENT_URL_TTL_SECS } from "./constants.js";
import { isMessageBodyWithinLimit } from "./body-length.js";
import { DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE } from "../pagination.constants.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import {
  BYTES_PER_MB,
  CHAT_DEFAULT_BUCKET,
  CHAT_MAX_FILE_BYTES,
} from "../../utils/cache/constants.js";
import type { StoryPreview } from "../story/types.js";
import type { Story } from "../story/schema.js";
import { toStoryPreview } from "../story/dto/mapper.js";
import { STORY_REPOSITORY, type StoryRepository } from "../story/repository.js";

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
    @Inject(STORY_REPOSITORY) private readonly storyRepo: StoryRepository,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: StorageService,
  ) {}

  /** Resolve live story previews (presigned media URL) and redact dead ones to null. */
  private async resolveStoryPreviews(
    items: Array<{ storyPreview?: StoryPreview | null }>,
    viewerId: string,
  ): Promise<void> {
    const ids = [
      ...new Set(
        items.map((item) => item.storyPreview?.id).filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) return;
    const stories = await this.storyRepo.findViewableByIds(ids, viewerId);
    const byId = new Map(stories.map((story) => [story.id, story]));
    await Promise.all(
      items.map(async (item) => {
        const preview = item.storyPreview;
        if (!preview) return;
        const story = byId.get(preview.id);
        item.storyPreview = story
          ? { ...toStoryPreview(story), mediaUrl: await this.presignStoryMedia(story) }
          : null;
      }),
    );
  }

  private async presignStoryMedia(story: Story): Promise<string | null> {
    if (!this.storage || !story.objectKey) return null;
    try {
      const { downloadUrl } = await this.storage.presignGet({
        objectKey: story.objectKey,
        disposition: "inline",
        ...(story.mimeType && { mimeType: story.mimeType }),
        expiresInSecs: ATTACHMENT_URL_TTL_SECS,
      });
      return downloadUrl;
    } catch {
      return null;
    }
  }

  private inferContentCategory(message: ReplyTargetMessage): ReplyContentCategory {
    if (message.kind === "STORY_REPLY" || message.kind === "STORY_REACTION") {
      return "STORY";
    }
    if (message.attachments && message.attachments.length > 0) {
      if (message.attachments.every((a) => a.kind === "AUDIO")) {
        return "VOICE";
      }
      return "ATTACHMENT";
    }
    if (message.kind === "AUDIO") return "VOICE";
    if (message.kind === "IMAGE" || message.kind === "VIDEO" || message.kind === "FILE") {
      return "ATTACHMENT";
    }
    if (message.kind === "TEXT") return "MESSAGE";
    return "UNKNOWN";
  }

  private replyTarget(message: ReplyTargetMessage): ReplyTargetResponse {
    return {
      id: message.id,
      senderId: message.senderId,
      kind: message.kind,
      body: message.deletedAt ? null : message.body,
      deletedAt: message.deletedAt,
      storyPreview: message.deletedAt ? null : message.storyPreview,
      contentCategory: this.inferContentCategory(message),
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

    if (body && !isMessageBodyWithinLimit(body)) {
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
          maxMb: String(Math.floor(CHAT_MAX_FILE_BYTES / BYTES_PER_MB)),
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

    let bucket = CHAT_DEFAULT_BUCKET;
    if (this.storage) {
      try {
        bucket = this.storage.getBucket();
      } catch {
        bucket = CHAT_DEFAULT_BUCKET;
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
        ? this.messageRepo.findReplyTargets(conversationId, [message.replyToId], senderId)
        : Promise.resolve([]),
    ]);
    const response = await this.attachSender(mapped);
    if (message.replyToId) {
      const [replyTargetMsg] = target;
      if (replyTargetMsg) {
        const replyTarget = this.replyTarget(replyTargetMsg);
        const [replySender] = await this.messageRepo.findSenderProfiles([replyTargetMsg.senderId]);
        if (replySender) replyTarget.sender = replySender;
        response.replyTarget = replyTarget;
      } else response.replyTarget = null;
    }

    await this.resolveStoryPreviews(
      [response, ...(response.replyTarget ? [response.replyTarget] : [])],
      senderId,
    );

    if (isNew) {
      // replyTarget is viewer-dependent: a user can hide a message locally or
      // be below the group's history boundary. Realtime events broadcast
      // without replyTarget content to prevent cross-epoch leaks; clients
      // fetch replyTarget on-demand via the authenticated quote endpoint if not cached.
      // The event omits replyTarget entirely so clients can tell "gone"
      // (null in timeline responses) from "not embedded" (fetch on-demand).
      const eventMessage = { ...response };
      delete eventMessage.replyTarget;
      const participantIds = await this.convRepo.getParticipantUserIds(conversationId);
      const recipientPayloads = participantIds.map((participantId) => ({
        userId: participantId,
        payload: eventMessage,
      }));
      this.realtimeService.emitNewMessage(conversationId, eventMessage, recipientPayloads);
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
    return this.decorateTimeline(conversationId, userId, timeline);
  }

  /** Cửa sổ tin nhắn quanh một tin: nửa mới hơn + anchor + nửa cũ hơn, thứ tự mới nhất trước. */
  async getMessageWindow(
    userId: string,
    conversationId: string,
    messageId: string,
    limit?: number,
  ): Promise<MessageWindowResponse> {
    const [, anchorAccessible] = await Promise.all([
      this.assertDirectConversationAllowed(conversationId, userId),
      this.convRepo.canAccessMessage(conversationId, userId, messageId),
    ]);
    if (!anchorAccessible) throw new BusinessError("MESSAGE_NOT_FOUND");

    const size = Math.min(Math.max(limit ?? DEFAULT_MESSAGE_PAGE_SIZE, 1), MAX_MESSAGE_PAGE_SIZE);
    const [anchor] = await this.messageRepo.findReplyTargets(conversationId, [messageId], userId);
    if (!anchor) throw new BusinessError("MESSAGE_NOT_FOUND");

    const newerCount = Math.floor((size - 1) / 2);
    const olderCount = size - 1 - newerCount;
    const emptySide: MessageTimelineResult = { items: [], hasMore: false, authorized: true };
    const [anchorRow, older, newer] = await Promise.all([
      this.messageRepo.findById(messageId, true),
      olderCount > 0
        ? this.messageRepo.findTimeline(conversationId, userId, messageId, olderCount)
        : Promise.resolve(emptySide),
      newerCount > 0
        ? this.messageRepo.findTimeline(conversationId, userId, undefined, newerCount, messageId)
        : Promise.resolve(emptySide),
    ]);
    if (!anchorRow) throw new BusinessError("MESSAGE_NOT_FOUND");
    if (older.authorized === false || newer.authorized === false) {
      throw new BusinessError("NOT_PARTICIPANT");
    }

    const timeline: MessageTimelineResult = {
      items: [...newer.items.slice().reverse(), anchorRow, ...older.items],
      hasMore: older.hasMore,
      ...(older.nextCursor !== undefined && { nextCursor: older.nextCursor }),
      authorized: true,
    };
    const response = await this.decorateTimeline(conversationId, userId, timeline);
    return { ...response, hasMoreNewer: newer.hasMore };
  }

  private async decorateTimeline(
    conversationId: string,
    userId: string,
    timeline: MessageTimelineResult,
  ): Promise<MessageTimelineResponse> {
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
    await this.resolveStoryPreviews(
      [
        ...response.items,
        ...response.items.flatMap((item) => (item.replyTarget ? [item.replyTarget] : [])),
      ],
      userId,
    );
    return response;
  }

  async getReplyTarget(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ReplyTargetResponse> {
    const isMember = await this.convRepo.isParticipant(conversationId, userId);
    if (!isMember) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    const [target] = await this.messageRepo.findReplyTargets(conversationId, [messageId], userId);
    if (!target) {
      throw new BusinessError("MESSAGE_NOT_FOUND");
    }
    const replyTarget = this.replyTarget(target);
    const [replySender] = await this.messageRepo.findSenderProfiles([target.senderId]);
    if (replySender) replyTarget.sender = replySender;

    if (!target.deletedAt && target.attachments && target.attachments.length > 0) {
      const firstAtt = target.attachments[0];
      let previewUrl: string | undefined;
      if (this.storage && (firstAtt.kind === "IMAGE" || firstAtt.kind === "VIDEO")) {
        try {
          const res = await this.storage.presignGet({
            objectKey: firstAtt.objectKey,
            fileName: firstAtt.fileName,
            disposition: "inline",
            mimeType: firstAtt.mimeType,
            expiresInSecs: ATTACHMENT_URL_TTL_SECS,
          });
          previewUrl = res.downloadUrl;
        } catch {
          previewUrl = undefined;
        }
      }
      replyTarget.previewAttachment = {
        id: firstAtt.id,
        kind: firstAtt.kind,
        fileName: firstAtt.fileName,
        mimeType: firstAtt.mimeType,
        width: firstAtt.width,
        height: firstAtt.height,
        durationMs: firstAtt.durationMs,
        ...(previewUrl ? { previewUrl } : {}),
      };
    }

    await this.resolveStoryPreviews([replyTarget], userId);
    return replyTarget;
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

    if (!isMessageBodyWithinLimit(body)) {
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
