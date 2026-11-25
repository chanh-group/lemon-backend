export interface ConversationWithPartner {
  id: string;
  kind: "DIRECT" | "GROUP";
  directKey: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  memberCount?: number;
  myRole?: "ADMIN" | "MEMBER";
  joinGeneration?: string;
  historyBoundaryMessageId?: string | null;
  historyBoundaryWasEmpty?: boolean;
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

export interface GroupCreateRequestMatch {
  id: string;
  createRequestHash: string | null;
  deletedAt: Date | null;
}

export interface CreatedGroupResult {
  conversation: ConversationWithPartner;
  created: boolean;
}

export interface ConversationRepository {
  createGroup(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
    clientRequestId: string;
    createRequestHash: string;
  }): Promise<CreatedGroupResult>;
  findGroupCreateRequest(
    creatorId: string,
    clientRequestId: string,
  ): Promise<GroupCreateRequestMatch | null>;
  addGroupMembers(
    conversationId: string,
    actorId: string,
    memberIds: string[],
  ): Promise<ConversationWithPartner>;
  removeGroupMember(conversationId: string, actorId: string, userId: string): Promise<void>;
  updateGroup(conversationId: string, actorId: string, title: string): Promise<void>;
  updateGroupAvatar(conversationId: string, actorId: string, avatarUrl: string): Promise<void>;
  getGroupAvatarUrl(conversationId: string): Promise<string | null>;
  getAccessibleGroupAvatarUrl(
    conversationId: string,
    userId: string,
  ): Promise<{ avatarUrl: string | null } | null>;
  updateMemberRole(
    conversationId: string,
    actorId: string,
    userId: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<void>;
  leaveGroup(conversationId: string, userId: string): Promise<{ closed: boolean }>;
  disbandGroup(conversationId: string, actorId: string): Promise<string[]>;
  listMembers(
    conversationId: string,
  ): Promise<import("./dto/response.js").ConversationMemberResponse[]>;
  getGroupMembership(
    conversationId: string,
    userId: string,
  ): Promise<{
    role: "ADMIN" | "MEMBER";
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
  canAccessMessage(conversationId: string, userId: string, messageId: string): Promise<boolean>;
  getMessageRecipientUserIds(conversationId: string, messageId: string): Promise<string[]>;
  getParticipantUserIds(conversationId: string): Promise<string[]>;
  updateLastRead(conversationId: string, userId: string, messageId: string): Promise<void>;
  countUnread(conversationId: string, userId: string): Promise<number>;
  countUnreadByConversationIds(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>>;
  findPendingAvatarCleanupJobs(
    limit: number,
  ): Promise<
    Array<{ id: string; conversationId: string | null; objectKey: string; attempts: number }>
  >;
  getGroupAvatarUrls(conversationIds: string[]): Promise<Map<string, string | null>>;
  completeAvatarCleanupJobs(ids: string[]): Promise<number>;
  failAvatarCleanupJobs(
    entries: Array<{ id: string; attempts: number; error: string }>,
  ): Promise<void>;
}

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");
import type { CursorPage } from "../shared.js";
