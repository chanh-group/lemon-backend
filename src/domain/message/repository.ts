import type { StoryPreview } from "../story/dto/response.js";
import type { Message, MessageAttachment, MessageKind } from "./schema.js";

export type MessageWithAttachments = Message & {
  attachments?: MessageAttachment[];
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
  }): Promise<CreatedMessageResult>;
  findTimeline(
    conversationId: string,
    cursor?: string,
    limit?: number,
    after?: string,
  ): Promise<MessageTimelineResult>;
  findById(messageId: string): Promise<MessageWithAttachments | null>;
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
}

export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
