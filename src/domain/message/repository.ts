import type { StoryPreview } from "../story/types.js";
import type { Message, MessageAttachment, MessageKind, MessageReaction } from "./schema.js";
import type { MessageReactionSummary } from "./dto/response.js";

export type MessageWithAttachments = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
};

/** Attachment columns consumed by the response mapper (no bucket/checksum/createdAt). */
export type AttachmentResponseSource = Pick<
  MessageAttachment,
  | "id"
  | "messageId"
  | "kind"
  | "objectKey"
  | "fileName"
  | "mimeType"
  | "sizeBytes"
  | "width"
  | "height"
  | "durationMs"
>;

/** Reaction columns consumed by the response mapper (no createdAt). */
export type ReactionResponseSource = Pick<MessageReaction, "messageId" | "userId" | "emoji">;

/** Message columns consumed when rendering a reply target. */
export type ReplyTargetMessage = Pick<
  Message,
  "id" | "senderId" | "kind" | "body" | "deletedAt" | "storyPreview"
>;

/** Message row plus the projected extras consumed by the response mapper. */
export type MessageResponseSource = Message & {
  attachments?: AttachmentResponseSource[];
  reactions?: ReactionResponseSource[];
};

export interface AttachmentInsertData {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind?: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  checksum?: string | null;
}

export interface MessageTimelineResult {
  items: MessageResponseSource[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CreatedMessageResult {
  message: MessageWithAttachments;
  isNew: boolean;
}

export interface MessageRepository {
  createMessageWithConversationUpdate(messageData: {
    conversationId: string;
    senderId: string;
    body?: string | null;
    kind?: MessageKind;
    clientMsgId?: string | null;
    replyToId?: string | null;
    requiredFriendship?: { userAId: string; userBId: string };
    storyId?: string | null;
    storyPreview?: StoryPreview | null;
    attachments?: AttachmentInsertData[];
    isForwarded?: boolean;
  }): Promise<CreatedMessageResult>;
  findTimeline(
    conversationId: string,
    cursor?: string,
    limit?: number,
    after?: string,
  ): Promise<MessageTimelineResult>;
  findById(messageId: string, includeDetails?: boolean): Promise<MessageWithAttachments | null>;
  findReplyTargets(conversationId: string, messageIds: string[]): Promise<ReplyTargetMessage[]>;
  resolveWriteMiss(
    messageId: string,
    userId: string,
    conversationId: string,
  ): Promise<MessageWithAttachments | null>;
  updateBody(
    messageId: string,
    senderId: string,
    body: string,
  ): Promise<MessageWithAttachments | null>;
  softDelete(messageId: string, senderId: string): Promise<MessageWithAttachments | null>;
  reactMessage(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ reactions: MessageReactionSummary[]; conversationId: string }>;
}

export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
