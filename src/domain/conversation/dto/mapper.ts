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
    lastMessageSenderId: conv.lastMessageSenderId ?? null,
    ...(conv.lastMessageSender && { lastMessageSender: conv.lastMessageSender }),
    lastMessageAt: conv.lastMessageAt,
    unreadCount: conv.unreadCount ?? 0,
    createdAt: conv.createdAt,
    ...(conv.kind === "GROUP" && {
      title: conv.title ?? null,
      avatarUrl: conv.avatarUrl ?? null,
      memberCount: conv.memberCount ?? 0,
      myRole: conv.myRole ?? "MEMBER",
    }),
  };
}
