import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  STORY_ALLOWED_IMAGE_MIME,
  STORY_ALLOWED_VIDEO_MIME,
  STORY_FEED_TTL_SECS,
  STORY_MAX_IMAGE_BYTES,
  STORY_MAX_VIDEO_BYTES,
  STORY_TTL_MS,
} from "../../utils/cache/constants.js";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { storyFeedKey } from "../../utils/cache/keys.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import { BusinessError } from "../../utils/errors/business.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import { groupStoriesByUser, reviveUserStoryFeed, toStoryItemResponse } from "./dto/mapper.js";
import type { CreateStoryDto } from "./dto/request.js";
import type {
  StoryItemResponse,
  StoryViewerResponse,
  UserStoryFeedResponse,
} from "./dto/response.js";
import { STORY_REPOSITORY, type StoryRepository } from "./repository.js";
import type { NewStory } from "./schema.js";

const BYTES_PER_MB = 1024 * 1024;

const STORY_MEDIA_RULES: Record<
  "IMAGE" | "VIDEO",
  { maxBytes: number; allowedMimes: readonly string[] }
> = {
  IMAGE: { maxBytes: STORY_MAX_IMAGE_BYTES, allowedMimes: STORY_ALLOWED_IMAGE_MIME },
  VIDEO: { maxBytes: STORY_MAX_VIDEO_BYTES, allowedMimes: STORY_ALLOWED_VIDEO_MIME },
};

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    @Inject(STORY_REPOSITORY) private readonly storyRepo: StoryRepository,
    @Inject(CACHE_STORE) private readonly cache: CacheStoreExt,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly metrics?: RedisMetricsService,
  ) {}

  async createStory(userId: string, dto: CreateStoryDto): Promise<StoryItemResponse> {
    const isMedia = dto.kind === "IMAGE" || dto.kind === "VIDEO";

    let bucket: string | null = null;
    let head: { contentLength: number; contentType: string } | null = null;

    if (isMedia) {
      if (!dto.objectKey) {
        throw new BusinessError("INVALID_MEDIA_TYPE");
      }
      if (!dto.objectKey.startsWith(`stories/${userId}/`)) {
        throw new BusinessError("INVALID_OBJECT_KEY");
      }

      head = await this.storage.headObject(dto.objectKey);
      if (!head) {
        throw new BusinessError("OBJECT_NOT_UPLOADED");
      }

      const rules = dto.kind === "IMAGE" ? STORY_MEDIA_RULES.IMAGE : STORY_MEDIA_RULES.VIDEO;
      if (head.contentLength > rules.maxBytes) {
        throw new BusinessError("FILE_TOO_LARGE", {
          maxMb: String(Math.floor(rules.maxBytes / BYTES_PER_MB)),
        });
      }
      if (!rules.allowedMimes.includes(head.contentType)) {
        throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: head.contentType });
      }

      bucket = this.storage.getBucket();
    }

    const caption = dto.caption?.trim() || null;
    const background = dto.background?.trim() || null;
    if (dto.kind === "TEXT" && !caption && !background) {
      throw new BusinessError("TEXT_STORY_REQUIRES_CONTENT");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + STORY_TTL_MS);

    const newStoryData: NewStory = {
      userId,
      kind: dto.kind,
      bucket,
      objectKey: isMedia ? (dto.objectKey ?? null) : null,
      mimeType: isMedia ? (head?.contentType ?? null) : null,
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
    await this.cache.deleteManyBestEffort([userId, ...friendIds].map(storyFeedKey));

    this.logger.log("Story created successfully", { storyId: created.id, userId, kind: dto.kind });

    return toStoryItemResponse(created, false);
  }

  async getFeed(userId: string): Promise<UserStoryFeedResponse[]> {
    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    const visibleUserIds = new Set([userId, ...friendIds]);
    const cacheKey = storyFeedKey(userId);
    const cached = await this.cache.getBestEffort<UserStoryFeedResponse[]>(cacheKey);
    this.metrics?.recordLookup("story_feed", cached === null ? "miss" : "hit");
    if (cached) {
      return reviveUserStoryFeed(cached.filter((entry) => visibleUserIds.has(entry.user.id)));
    }

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
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
      if (!friendIds.includes(userId)) {
        throw new BusinessError("STORY_VIEW_FORBIDDEN");
      }
    }

    const viewedIds = await this.storyRepo.findViewedStoryIds(userId, [storyId]);
    return toStoryItemResponse(story, viewedIds.has(storyId));
  }

  async viewStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      // Self-views are a no-op: the owner already knows the content and must
      // not appear in their own viewers list.
      return;
    }

    const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
    if (!friendIds.includes(userId)) {
      throw new BusinessError("STORY_VIEW_FORBIDDEN");
    }

    await this.storyRepo.markAsViewed(storyId, userId);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async getViewers(userId: string, storyId: string): Promise<StoryViewerResponse[]> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      throw new BusinessError("STORY_VIEWERS_FORBIDDEN");
    }

    return this.storyRepo.findViewersByStoryId(storyId);
  }

  async deleteStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      throw new BusinessError("STORY_DELETE_FORBIDDEN");
    }

    const deleted = await this.storyRepo.markDeleted(storyId);
    if (!deleted) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    const friendIds = await this.storyRepo.getFriendUserIds(userId);
    await this.cache.deleteManyBestEffort([userId, ...friendIds].map(storyFeedKey));

    this.logger.log("Story deleted", { storyId, userId });
  }
}
