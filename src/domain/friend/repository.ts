import type { Friendship } from "./schema.js";

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
  listRequests(userId: string): Promise<{ incoming: FriendRequestRecord[]; outgoing: FriendRequestRecord[] }>;
  listFriends(userId: string): Promise<FriendUser[]>;
  acceptRequest(requestId: string, addresseeId: string): Promise<boolean>;
  deleteIncomingRequest(requestId: string, addresseeId: string): Promise<boolean>;
  deleteOutgoingRequest(requestId: string, requesterId: string): Promise<boolean>;
  deleteAcceptedPair(userAId: string, userBId: string): Promise<boolean>;
  blockPair(blockerId: string, targetId: string): Promise<void>;
}

export const FRIEND_REPOSITORY = Symbol("FRIEND_REPOSITORY");
