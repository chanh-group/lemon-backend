export interface ConversationWithPartner {
  id: string;
  kind: "DIRECT" | "GROUP";
  directKey: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  memberCount?: number;
  myRole?: "OWNER" | "ADMIN" | "MEMBER";
  historyBoundaryMessageId?: string | null;
  lastReadAt?: Date | null;
  partner?: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    isOnline?: boolean;
  };
  lastMessagePreview: string | null;
  lastMessageSenderId?: string | null;
  lastMessageSender?: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
  } | null;
  lastMessageAt: Date | null;
  unreadCount?: number;
  unreadRevision?: string;
  lastReadMessageId?: string | null;
  createdAt: Date;
}

export interface ConversationRepository {
  createGroup(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
    clientRequestId: string;
    createRequestHash: string;
  }): Promise<ConversationWithPartner>;
  addGroupMembers(
    conversationId: string,
    actorId: string,
    memberIds: string[],
  ): Promise<ConversationWithPartner>;
  removeGroupMember(conversationId: string, actorId: string, userId: string): Promise<void>;
  updateGroup(conversationId: string, actorId: string, title: string): Promise<void>;
  updateMemberRole(
    conversationId: string,
    actorId: string,
    userId: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<void>;
  transferOwnership(conversationId: string, actorId: string, newOwnerId: string): Promise<void>;
  leaveGroup(conversationId: string, userId: string): Promise<{ closed: boolean }>;
  listMembers(
    conversationId: string,
  ): Promise<import("./dto/response.js").ConversationMemberResponse[]>;
  getGroupMembership(
    conversationId: string,
    userId: string,
  ): Promise<{
    role: "OWNER" | "ADMIN" | "MEMBER";
    historyBoundaryMessageId: string | null;
  } | null>;
  findDirectByParticipants(
    userAId: string,
    userBId: string,
  ): Promise<ConversationWithPartner | null>;
  createDirectConversation(userAId: string, userBId: string): Promise<ConversationWithPartner>;
  findUserConversations(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<ConversationWithPartner>>;
  findById(conversationId: string, userId: string): Promise<ConversationWithPartner | null>;
  existsById(conversationId: string): Promise<boolean>;
  isParticipant(conversationId: string, userId: string): Promise<boolean>;
  isMessageInConversation(conversationId: string, messageId: string): Promise<boolean>;
  canAccessMessage(conversationId: string, userId: string, messageId: string): Promise<boolean>;
  getParticipantUserIds(conversationId: string): Promise<string[]>;
  updateLastRead(conversationId: string, userId: string, messageId: string): Promise<void>;
  countUnread(conversationId: string, userId: string): Promise<number>;
  countUnreadByConversationIds(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
import type { CursorPage } from "../shared.js";
