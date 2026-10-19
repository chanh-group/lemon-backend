import type { ConversationWithPartner } from "../repository.js";
import type { ConversationResponse } from "./response.js";

export function toConversationResponse(conv: ConversationWithPartner): ConversationResponse {
  return {
    id: conv.id,
    kind: conv.kind,
    ...(conv.partner && {
      partner: {
        id: conv.partner.id,
        username: conv.partner.username,
        fullName: conv.partner.fullName,
        avatarUrl: conv.partner.avatarUrl,
        isOnline: conv.partner.isOnline ?? false,
      },
    }),
    lastMessagePreview: conv.lastMessagePreview,
    lastMessageAt: conv.lastMessageAt,
    unreadCount: conv.unreadCount ?? 0,
    createdAt: conv.createdAt,
  };
}
