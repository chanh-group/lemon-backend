export interface ConversationPartnerResponse {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  isOnline: boolean;
}

export interface ConversationResponse {
  id: string;
  kind: "DIRECT" | "GROUP";
  partner?: ConversationPartnerResponse;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
}
