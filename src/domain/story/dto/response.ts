import type { UserSummary } from "../../user/dto/response.js";
import type { StoryAudienceMode, StoryReactionKind } from "../constants.js";
import type { StoryKind } from "../schema.js";

export interface StoryItemResponse {
  id: string;
  userId: string;
  kind: StoryKind;
  bucket: string | null;
  objectKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  background: string | null;
  allowReplies?: boolean;
  allowReactions?: boolean;
  audienceMode?: StoryAudienceMode;
  archivedAt?: Date | null;
  createdAt: Date;
  expiresAt: Date;
  hasViewed?: boolean;
  myReaction?: string | null;
  myReactionKind?: StoryReactionKind | null;
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
  reactionKind?: StoryReactionKind | null;
}

export interface StoryViewersListResponse {
  items: StoryViewerResponse[];
  nextCursor: string | null;
  hasMore: boolean;
  totalViewsCount: number;
}

export interface StoryReactionResponse {
  user: UserSummary;
  emoji: string;
  kind: StoryReactionKind;
  createdAt: Date;
}

/** Reaction of the calling user on a story. */
export interface MyStoryReactionResponse {
  storyId: string;
  emoji: string;
  kind: StoryReactionKind;
  createdAt: Date;
}

export interface UserStorySettingsResponse {
  viewedReceiptsEnabled: boolean;
  archiveEnabled: boolean;
  archiveDurationSecs: number | null;
}

/**
 * Immutable snapshot of a story, embedded in messages that quote it. The
 * snapshot outlives the story row (`messages.story_id` is `ON DELETE SET
 * NULL`), so it must stay self-contained.
 */
export type { StoryPreview } from "../types.js";
