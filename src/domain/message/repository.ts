import type { StoryPreview } from "../story/types.js";
import type { Message, MessageAttachment, MessageKind, MessageReaction } from "./schema.js";
import type { MessageReactionSummary } from "./dto/response.js";

export type MessageWithAttachments = Message & {
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
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
  items: MessageWithAttachments[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CreatedMessageResult {
  message: MessageWithAttachments;
  isNew: boolean;
}

export interface MessageRepository {
  findByClientMsgId(
    conversationId: string,
    senderId: string,
    clientMsgId: string,
  ): Promise<MessageWithAttachments | null>;
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
  findReplyTargets(conversationId: string, messageIds: string[]): Promise<Message[]>;
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
    requiredFriendship?: { userAId: string; userBId: string },
  ): Promise<{ reactions: MessageReactionSummary[]; conversationId: string }>;
}

export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
