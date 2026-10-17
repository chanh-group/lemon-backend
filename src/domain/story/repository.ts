import type { NewStory, Story } from "./schema.js";
import type { StoryViewerResponse } from "./dto/response.js";
import type { UserSummary } from "../user/dto/response.js";

export interface StoryRepository {
  create(data: NewStory): Promise<Story>;
  findById(id: string): Promise<Story | null>;
  findActiveById(id: string): Promise<Story | null>;
  findActiveByUserIds(userIds: string[]): Promise<Story[]>;
  findUsersByIds(userIds: string[]): Promise<Map<string, UserSummary>>;
  findViewersByStoryId(storyId: string): Promise<StoryViewerResponse[]>;
  findViewedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>>;
  markAsViewed(storyId: string, userId: string): Promise<void>;
  delete(id: string): Promise<boolean>;
  getFriendUserIds(userId: string): Promise<string[]>;
}

export const STORY_REPOSITORY: unique symbol = Symbol("STORY_REPOSITORY");
