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
  lastMessageSenderId?: string | null;
  lastMessageSender?: { id: string; username: string; fullName: string; avatarUrl: string | null };
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
  title?: string | null;
  avatarUrl?: string | null;
  memberCount?: number;
  myRole?: "ADMIN" | "MEMBER";
  joinGeneration?: string;
}

export interface ConversationMemberResponse {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: "ADMIN" | "MEMBER";
  joinedAt: Date;
}
