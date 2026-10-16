import type { Message } from "./schema.js";

export interface MessageTimelineResult {
  items: Message[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface MessageRepository {
  findByClientMsgId(conversationId: string, senderId: string, clientMsgId: string): Promise<Message | null>;
  createMessageWithConversationUpdate(
    messageData: {
      conversationId: string;
      senderId: string;
      body?: string | null;
      kind?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "SYSTEM";
      clientMsgId?: string | null;
      replyToId?: string | null;
    },
  ): Promise<Message>;
  findTimeline(conversationId: string, cursor?: string, limit?: number, after?: string): Promise<MessageTimelineResult>;
  findById(messageId: string): Promise<Message | null>;
  updateBody(messageId: string, senderId: string, body: string): Promise<Message | null>;
  softDelete(messageId: string, senderId: string): Promise<Message | null>;
}

export const MESSAGE_REPOSITORY = Symbol("MESSAGE_REPOSITORY");
