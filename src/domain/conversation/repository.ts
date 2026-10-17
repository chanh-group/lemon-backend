
export interface ConversationWithPartner {
  id: string;
  kind: "DIRECT" | "GROUP";
  directKey: string | null;
  partner?: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    isOnline?: boolean;
  };
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  unreadCount?: number;
  lastReadMessageId?: string | null;
  createdAt: Date;
}

export interface ConversationRepository {
  findDirectByParticipants(userAId: string, userBId: string): Promise<ConversationWithPartner | null>;
  createDirectConversation(userAId: string, userBId: string): Promise<ConversationWithPartner>;
  findUserConversations(userId: string, limit?: number): Promise<ConversationWithPartner[]>;
  findById(conversationId: string, userId: string): Promise<ConversationWithPartner | null>;
  existsById(conversationId: string): Promise<boolean>;
  isParticipant(conversationId: string, userId: string): Promise<boolean>;
  getParticipantUserIds(conversationId: string): Promise<string[]>;
  updateLastRead(conversationId: string, userId: string, messageId: string): Promise<void>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
