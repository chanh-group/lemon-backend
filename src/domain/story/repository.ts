import type { NewStory, Story, StoryReaction } from "./schema.js";
import type { StoryReactionResponse, StoryViewerResponse } from "./dto/response.js";
import type { UserSummary } from "../user/dto/response.js";
import type { CursorPage } from "../shared.js";

export type PurgeableStory = { id: string; objectKey: string | null };

export interface StoryRepository {
  create(data: NewStory): Promise<Story>;
  findById(id: string): Promise<Story | null>;
  findActiveById(id: string): Promise<Story | null>;
  findActiveByUserIds(userIds: string[]): Promise<Story[]>;
  findUsersByIds(userIds: string[]): Promise<Map<string, UserSummary>>;
  isAcceptedFriend(userAId: string, userBId: string): Promise<boolean>;
  findViewersByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryViewerResponse>>;
  findViewedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>>;
  markAsViewed(storyId: string, userId: string): Promise<void>;
  markDeleted(id: string): Promise<boolean>;
  getFriendUserIds(userId: string): Promise<string[]>;
  findPurgeable(limit: number): Promise<PurgeableStory[]>;
  deleteByIds(ids: string[]): Promise<number>;
  addOrUpdateReaction(storyId: string, userId: string, emoji: string): Promise<StoryReaction>;
  deleteReaction(storyId: string, userId: string): Promise<boolean>;
  findReactionsByStoryId(storyId: string): Promise<StoryReactionResponse[]>;
  findUserReactions(userId: string, storyIds: string[]): Promise<Map<string, string>>;
  countReactions(storyIds: string[]): Promise<Map<string, number>>;
}

export const STORY_REPOSITORY: unique symbol = Symbol("STORY_REPOSITORY");

