import type { MessageTimelineResult } from "../repository.js";
import type { Message } from "../schema.js";
import type { MessageResponse, MessageTimelineResponse } from "./response.js";

export function toMessageResponse(message: Message): MessageResponse {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    kind: message.kind,
    body: message.deletedAt ? null : message.body,
    replyToId: message.replyToId,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
  };
}

export function toMessageTimeline(result: MessageTimelineResult): MessageTimelineResponse {
  return {
    items: result.items.map(toMessageResponse),
    ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    hasMore: result.hasMore,
  };
}
