// Realtime wire payload types — shared by the gateway and RealtimeService.

import type { MessageResponse } from "../message/dto/response.js";
import type { UserSummary } from "../user/dto/response.js";

export interface SocketUser {
  userId: string;
}

export interface SocketReadyEvent {
  userId: string;
}

export interface UserMessagePayload {
  userId: string;
  payload: MessageResponse;
}

export interface StoryReactionEvent {
  storyId: string;
  user: UserSummary;
  emoji: string;
  createdAt: Date;
}

export interface StoryReactionRemovedEvent {
  storyId: string;
  user: UserSummary;
}

export interface FriendRequestCancelledEvent {
  requestId: string;
  requesterId: string;
}

export interface FriendRequestAcceptedEvent {
  requestId: string;
  addresseeId: string;
}

export interface FriendRequestDeclinedEvent {
  requestId: string;
  addresseeId: string;
}
