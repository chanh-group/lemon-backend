import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { storyFeedKey } from "../../utils/cache/keys.js";
import { groupStoriesByUser, toStoryItemResponse } from "./dto/mapper.js";
import type { CreateStoryDto } from "./dto/request.js";
import type { StoryItemResponse, StoryViewerResponse, UserStoryFeedResponse } from "./dto/response.js";
import { STORY_REPOSITORY, type StoryRepository } from "./repository.js";
import type { NewStory } from "./schema.js";

const STORY_FEED_TTL_SECS = 60;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    @Inject(STORY_REPOSITORY) private readonly storyRepo: StoryRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStoreExt,
  ) {}

  async createStory(userId: string, dto: CreateStoryDto): Promise<StoryItemResponse> {
    if (dto.kind === "TEXT") {
      if (!dto.caption && !dto.background) {
        throw new BadRequestException("TEXT story requires either caption or background");
      }
    } else if (dto.kind === "IMAGE" || dto.kind === "VIDEO") {
      if (!dto.objectKey) {
        throw new BadRequestException("INVALID_MEDIA_TYPE: Media story requires objectKey");
      }
    } else {
      throw new BadRequestException("INVALID_MEDIA_TYPE: Unsupported story kind");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TWENTY_FOUR_HOURS_MS);

    const newStoryData: NewStory = {
      userId,
      kind: dto.kind,
      bucket: dto.bucket ?? "lemon-stories",
      objectKey: dto.objectKey ?? null,
      mimeType: dto.mimeType ?? null,
      width: dto.width ?? null,
      height: dto.height ?? null,
      durationMs: dto.durationMs ?? null,
      caption: dto.caption ?? null,
      background: dto.background ?? null,
      createdAt: now,
      expiresAt,
    };

    const created = await this.storyRepo.create(newStoryData);

    // Invalidate feed cache for owner and all accepted friends in parallel
    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    const keysToInvalidate = [userId, ...friendIds].map(storyFeedKey);
    await Promise.all(keysToInvalidate.map((key) => this.cache.deleteBestEffort(key)));

    this.logger.log("Story created successfully", { storyId: created.id, userId, kind: dto.kind });

    return toStoryItemResponse(created, false);
  }

  async getFeed(userId: string): Promise<UserStoryFeedResponse[]> {
    const cacheKey = storyFeedKey(userId);
    const cached = await this.cache.getBestEffort<UserStoryFeedResponse[]>(cacheKey);
    if (cached) {
      return cached;
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

    if (story.userId !== userId) {
      const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
      if (!friendIds.includes(userId)) {
        throw new ForbiddenException("FORBIDDEN: You cannot view stories from non-friends");
      }
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
      throw new ForbiddenException("FORBIDDEN_VIEW_LIST: Only the story owner can view the viewers list");
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
    await Promise.all(keysToInvalidate.map((key) => this.cache.deleteBestEffort(key)));

    this.logger.log("Story deleted", { storyId, userId });
  }
}
