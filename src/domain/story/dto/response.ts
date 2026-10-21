import type { UserSummary } from "../../user/dto/response.js";

export interface StoryItemResponse {
  id: string;
  userId: string;
  kind: "IMAGE" | "VIDEO" | "TEXT";
  bucket: string | null;
  objectKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  background: string | null;
  createdAt: Date;
  expiresAt: Date;
  hasViewed?: boolean;
  myReaction?: string | null;
  reactionsCount?: number;
}

export interface UserStoryFeedResponse {
  user: UserSummary;
  stories: StoryItemResponse[];
}

export interface StoryViewerResponse {
  user: UserSummary;
  viewedAt: Date;
  reaction?: string | null;
}

export interface StoryReactionResponse {
  user: UserSummary;
  emoji: string;
  createdAt: Date;
}

/** Reaction of the calling user on a story. */
export interface MyStoryReactionResponse {
  storyId: string;
  emoji: string;
  createdAt: Date;
}

/**
 * Immutable snapshot of a story, embedded in messages that quote it. The
 * snapshot outlives the story row (`messages.story_id` is `ON DELETE SET
 * NULL`), so it must stay self-contained.
 */
export interface StoryPreview {
  id: string;
  kind: "IMAGE" | "VIDEO" | "TEXT";
  bucket: string | null;
  objectKey: string | null;
  caption: string | null;
  background: string | null;
}
