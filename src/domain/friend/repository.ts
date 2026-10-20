import type { Friendship } from "./schema.js";
import type { CursorPage } from "../shared.js";

export interface FriendUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
}

export interface FriendRequestRecord {
  id: string;
  user: FriendUser;
  direction: "incoming" | "outgoing";
  createdAt: Date;
}

export interface FriendRepository {
  findByPair(userAId: string, userBId: string): Promise<Friendship | null>;
  createRequest(
    requesterId: string,
    addresseeId: string,
  ): Promise<{ friendship: Friendship; created: boolean }>;
  listFriendsPage(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<FriendUser>>;
  findAcceptedFriendIds(userId: string, candidates: string[]): Promise<Set<string>>;
  listRequestsPage(
    userId: string,
    incomingCursor: string | undefined,
    outgoingCursor: string | undefined,
    limit: number,
  ): Promise<{
    incoming: CursorPage<FriendRequestRecord>;
    outgoing: CursorPage<FriendRequestRecord>;
  }>;
  acceptRequest(
    requestId: string,
    addresseeId: string,
  ): Promise<{ requesterId: string; addresseeId: string } | null>;
  deleteIncomingRequest(requestId: string, addresseeId: string): Promise<boolean>;
  deleteOutgoingRequest(requestId: string, requesterId: string): Promise<boolean>;
  deleteAcceptedPair(userAId: string, userBId: string): Promise<boolean>;
  blockPair(blockerId: string, targetId: string): Promise<void>;
}

export const FRIEND_REPOSITORY = Symbol("FRIEND_REPOSITORY");
