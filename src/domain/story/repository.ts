import type { NewStory, Story, StoryReaction, UserStorySettings } from "./schema.js";
import type {
  StoryItemResponse,
  StoryReactionResponse,
  StoryViewersListResponse,
} from "./dto/response.js";
import type { StoryReactionKind } from "./constants.js";
import type { UserSummary } from "../user/dto/response.js";
import type { CursorPage } from "../shared.js";

export type PurgeableStory = { id: string; objectKey: string | null; userId: string };

export interface StoryReactionResult {
  reaction: StoryReaction;
  isNew: boolean;
}

export interface UserReactionDetail {
  emoji: string;
  kind: StoryReactionKind;
}

export interface StoryRepository {
  create(data: NewStory, audienceUserIds?: string[]): Promise<Story>;
  findById(id: string): Promise<Story | null>;
  findActiveById(id: string): Promise<Story | null>;
  findActiveByUserIds(userIds: string[], viewerId?: string): Promise<Story[]>;
  findUsersByIds(userIds: string[]): Promise<Map<string, UserSummary>>;
  isAcceptedFriend(userAId: string, userBId: string): Promise<boolean>;
  findViewersByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<StoryViewersListResponse>;
  findViewedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>>;
  markAsViewed(storyId: string, userId: string, anonymous?: boolean): Promise<void>;
  markDeleted(id: string): Promise<boolean>;
  getFriendUserIds(userId: string): Promise<string[]>;
  findPurgeable(limit: number): Promise<PurgeableStory[]>;
  deleteByIds(ids: string[]): Promise<number>;
  archiveStories(ids: string[]): Promise<number>;
  /** Marks the story as viewed and upserts the reaction in one transaction. */
  addReactionWithView(
    storyId: string,
    userId: string,
    emoji: string,
    kind?: StoryReactionKind,
    anonymous?: boolean,
  ): Promise<StoryReactionResult>;
  deleteReaction(storyId: string, userId: string): Promise<boolean>;
  findReactionsByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
    kind?: StoryReactionKind,
  ): Promise<CursorPage<StoryReactionResponse>>;
  findUserReactions(userId: string, storyIds: string[]): Promise<Map<string, UserReactionDetail>>;
  countReactions(storyIds: string[]): Promise<Map<string, number>>;

  // Settings
  getUserStorySettings(userId: string): Promise<UserStorySettings>;
  upsertUserStorySettings(
    userId: string,
    data: {
      viewedReceiptsEnabled?: boolean;
      archiveEnabled?: boolean;
      archiveDurationSecs?: number | null;
    },
  ): Promise<UserStorySettings>;

  // Audience
  findStoryAudienceUserIds(storyId: string): Promise<string[]>;
  isStoryAudience(storyId: string, userId: string): Promise<boolean>;

  // Mutes
  muteAuthor(userId: string, authorId: string): Promise<void>;
  unmuteAuthor(userId: string, authorId: string): Promise<boolean>;
  getMutedAuthorIds(userId: string): Promise<string[]>;
  isAuthorMuted(userId: string, authorId: string): Promise<boolean>;

  // Archives
  findArchivedStoriesByUserId(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryItemResponse>>;
}

export const STORY_REPOSITORY: unique symbol = Symbol("STORY_REPOSITORY");
