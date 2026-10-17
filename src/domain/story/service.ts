import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  STORY_DEFAULT_BUCKET,
  STORY_FEED_TTL_SECS,
  STORY_TTL_MS,
} from "../../utils/cache/constants.js";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { storyFeedKey } from "../../utils/cache/keys.js";
import { groupStoriesByUser, reviveUserStoryFeed, toStoryItemResponse } from "./dto/mapper.js";
import type { CreateStoryDto } from "./dto/request.js";
import type {
  StoryItemResponse,
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "./dto/response.js";
import { STORY_REPOSITORY, type StoryRepository } from "./repository.js";
import type { NewStory } from "./schema.js";

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    @Inject(STORY_REPOSITORY) private readonly storyRepo: StoryRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStoreExt,
  ) {}

  async createStory(userId: string, dto: CreateStoryDto): Promise<StoryItemResponse> {
    if (dto.kind === "IMAGE" || dto.kind === "VIDEO") {
      if (!dto.objectKey) {
        throw new BadRequestException("INVALID_MEDIA_TYPE: Media story requires objectKey");
      }
      if (!dto.objectKey.startsWith(`stories/${userId}/`)) {
        throw new BadRequestException(
          "INVALID_OBJECT_KEY: objectKey must be scoped to your user folder",
        );
      }
    }

    const caption = dto.caption?.trim() || null;
    const background = dto.background?.trim() || null;
    if (dto.kind === "TEXT" && !caption && !background) {
      throw new BadRequestException("TEXT story requires either caption or background");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + STORY_TTL_MS);

    const newStoryData: NewStory = {
      userId,
      kind: dto.kind,
      bucket: dto.kind === "TEXT" ? null : STORY_DEFAULT_BUCKET,
      objectKey: dto.kind === "TEXT" ? null : (dto.objectKey ?? null),
      mimeType: dto.mimeType ?? null,
      width: dto.width ?? null,
      height: dto.height ?? null,
      durationMs: dto.durationMs ?? null,
      caption,
      background,
      createdAt: now,
      expiresAt,
    };

    const created = await this.storyRepo.create(newStoryData);

    // Invalidate feed cache for owner and all accepted friends in 1 round trip
    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    const keysToInvalidate = [userId, ...friendIds].map(storyFeedKey);
    await this.cache.deleteManyBestEffort(keysToInvalidate);

    this.logger.log("Story created successfully", { storyId: created.id, userId, kind: dto.kind });

    return toStoryItemResponse(created, false);
  }

  async getFeed(userId: string): Promise<UserStoryFeedResponse[]> {
    const cacheKey = storyFeedKey(userId);
    const cached = await this.cache.getBestEffort<UserStoryFeedResponse[]>(cacheKey);
    if (cached) {
      return reviveUserStoryFeed(cached);
    }

    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    const targetUserIds = [userId, ...friendIds];

    // Parallel fetch: active stories and user profile summaries
    const [stories, usersMap] = await Promise.all([
      this.storyRepo.findActiveByUserIds(targetUserIds),
      this.storyRepo.findUsersByIds(targetUserIds),
    ]);

    const storyIds = stories.map((s) => s.id);
    const viewedStoryIds = await this.storyRepo.findViewedStoryIds(userId, storyIds);

    const feed = groupStoriesByUser(usersMap, stories, viewedStoryIds);

    await this.cache.setBestEffort(cacheKey, feed, STORY_FEED_TTL_SECS);

    return feed;
  }

  async getStoryById(userId: string, storyId: string): Promise<StoryItemResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new NotFoundException("STORY_NOT_FOUND: Story does not exist or has expired");
    }

    if (story.userId !== userId) {
      const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
      if (!friendIds.includes(userId)) {
        throw new ForbiddenException("FORBIDDEN: You cannot view stories from non-friends");
      }
    }

    const viewedIds = await this.storyRepo.findViewedStoryIds(userId, [storyId]);
    return toStoryItemResponse(story, viewedIds.has(storyId));
  }

  async viewStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new NotFoundException("STORY_NOT_FOUND: Story does not exist or has expired");
    }

    if (story.userId === userId) {
      // Self-views are a no-op: the owner already knows the content and must
      // not appear in their own viewers list.
      return;
    }

    const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
    if (!friendIds.includes(userId)) {
      throw new ForbiddenException("FORBIDDEN: You cannot view stories from non-friends");
    }

    await this.storyRepo.markAsViewed(storyId, userId);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async getViewers(userId: string, storyId: string): Promise<StoryViewerResponse[]> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      throw new NotFoundException("STORY_NOT_FOUND: Story does not exist");
    }

    if (story.userId !== userId) {
      throw new ForbiddenException(
        "FORBIDDEN_VIEW_LIST: Only the story owner can view the viewers list",
      );
    }

    return this.storyRepo.findViewersByStoryId(storyId);
  }

  async deleteStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      throw new NotFoundException("STORY_NOT_FOUND: Story does not exist");
    }

    if (story.userId !== userId) {
      throw new ForbiddenException("FORBIDDEN: You can only delete your own stories");
    }

    await this.storyRepo.delete(storyId);

    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    const keysToInvalidate = [userId, ...friendIds].map(storyFeedKey);
    await this.cache.deleteManyBestEffort(keysToInvalidate);

    this.logger.log("Story deleted", { storyId, userId });
  }
}
