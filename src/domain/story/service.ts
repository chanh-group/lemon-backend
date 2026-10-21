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
import { ConversationService } from "../conversation/service.js";
import type { MessageResponse } from "../message/dto/response.js";
import { MessageService } from "../message/service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import {
  groupStoriesByUser,
  reviveUserStoryFeed,
  toStoryItemResponse,
  toStoryPreview,
} from "./dto/mapper.js";
import type { StoryEmoji } from "./constants.js";
import type { CreateStoryDto, ReplyStoryDto } from "./dto/request.js";
import type {
  MyStoryReactionResponse,
  StoryItemResponse,
  StoryReactionResponse,
  UserStoryFeedResponse,
} from "./dto/response.js";
import { STORY_REPOSITORY, type StoryRepository } from "./repository.js";
import type { NewStory, Story } from "./schema.js";
import type { CursorPage } from "../shared.js";

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
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly realtimeService: RealtimeService,
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
    const cacheKey = storyFeedKey(userId);
    const [friendIds, cached] = await Promise.all([
      this.storyRepo.getFriendUserIds(userId),
      this.cache.getBestEffort<UserStoryFeedResponse[]>(cacheKey),
    ]);
    const visibleUserIds = new Set([userId, ...friendIds]);
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
    const [viewedStoryIds, userReactionsMap, reactionsCountMap] = await Promise.all([
      this.storyRepo.findViewedStoryIds(userId, storyIds),
      this.storyRepo.findUserReactions(userId, storyIds),
      this.storyRepo.countReactions(storyIds),
    ]);

    const feed = groupStoriesByUser(
      usersMap,
      stories,
      viewedStoryIds,
      userReactionsMap,
      reactionsCountMap,
    );

    await this.cache.setBestEffort(cacheKey, feed, STORY_FEED_TTL_SECS);

    return feed;
  }

  async getStoryById(userId: string, storyId: string): Promise<StoryItemResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      if (!(await this.storyRepo.isAcceptedFriend(story.userId, userId))) {
        throw new BusinessError("STORY_VIEW_FORBIDDEN");
      }
    }

    const [viewedIds, userReactionsMap, reactionsCountMap] = await Promise.all([
      this.storyRepo.findViewedStoryIds(userId, [storyId]),
      this.storyRepo.findUserReactions(userId, [storyId]),
      this.storyRepo.countReactions([storyId]),
    ]);
    return toStoryItemResponse(
      story,
      viewedIds.has(storyId),
      userReactionsMap.get(storyId) ?? null,
      reactionsCountMap.get(storyId) ?? 0,
    );
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

    if (!(await this.storyRepo.isAcceptedFriend(story.userId, userId))) {
      throw new BusinessError("STORY_VIEW_FORBIDDEN");
    }

    await this.storyRepo.markAsViewed(storyId, userId);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async getViewers(userId: string, storyId: string, cursor: string | undefined, limit: number) {
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      throw new BusinessError("STORY_VIEWERS_FORBIDDEN");
    }

    return this.storyRepo.findViewersByStoryId(storyId, cursor, limit);
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

  async reactStory(
    userId: string,
    storyId: string,
    emoji: StoryEmoji,
  ): Promise<MyStoryReactionResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REACT_OWN_STORY");
    }

    const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
    if (!friendIds.includes(userId)) {
      throw new BusinessError("STORY_REACT_FORBIDDEN");
    }

    await this.storyRepo.markAsViewed(storyId, userId);
    const { reaction, isNew } = await this.storyRepo.addOrUpdateReaction(storyId, userId, emoji);

    await Promise.all([
      this.cache.deleteBestEffort(storyFeedKey(userId)),
      this.cache.deleteBestEffort(storyFeedKey(story.userId)),
    ]);

    const usersMap = await this.storyRepo.findUsersByIds([userId]);
    const userSummary = usersMap.get(userId);
    if (userSummary) {
      const payload = {
        storyId,
        user: userSummary,
        emoji,
        createdAt: reaction.createdAt,
      };
      this.realtimeService.emitStoryReaction(story.userId, payload);
      this.realtimeService.emitStoryReaction(userId, payload);
    }

    if (isNew) {
      await this.sendReactionToDirectConversation(userId, story, emoji);
    }

    return {
      storyId: reaction.storyId,
      emoji: reaction.emoji,
      createdAt: reaction.createdAt,
    };
  }

  /**
   * A story reaction is routed into the author's direct conversation (Meta /
   * Signal behaviour, `docs/STORIES_NOTES.md` §5.2.A): the author sees the
   * reaction inside the chat thread, not only in the story UI.
   */
  private async sendReactionToDirectConversation(
    userId: string,
    story: Story,
    emoji: string,
  ): Promise<void> {
    const conv = await this.conversationService.getOrCreateDirect(userId, story.userId);
    await this.messageService.sendMessage(
      userId,
      conv.id,
      { kind: "TEXT", body: emoji },
      { storyId: story.id, storyPreview: toStoryPreview(story) },
    );
  }

  async unreactStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REACT_OWN_STORY");
    }

    const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
    if (!friendIds.includes(userId)) {
      throw new BusinessError("STORY_REACT_FORBIDDEN");
    }

    const removed = await this.storyRepo.deleteReaction(storyId, userId);
    if (!removed) {
      return;
    }

    await Promise.all([
      this.cache.deleteBestEffort(storyFeedKey(userId)),
      this.cache.deleteBestEffort(storyFeedKey(story.userId)),
    ]);

    const usersMap = await this.storyRepo.findUsersByIds([userId]);
    const userSummary = usersMap.get(userId);
    if (userSummary) {
      const payload = { storyId, user: userSummary };
      this.realtimeService.emitStoryReactionRemoved(story.userId, payload);
      this.realtimeService.emitStoryReactionRemoved(userId, payload);
    }
  }

  async getReactions(
    userId: string,
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryReactionResponse>> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      throw new BusinessError("STORY_REACTIONS_FORBIDDEN");
    }

    return this.storyRepo.findReactionsByStoryId(storyId, cursor, limit);
  }

  async replyStory(
    userId: string,
    storyId: string,
    dto: ReplyStoryDto,
  ): Promise<MessageResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REPLY_OWN_STORY");
    }

    const friendIds = await this.storyRepo.getFriendUserIds(story.userId);
    if (!friendIds.includes(userId)) {
      throw new BusinessError("STORY_REPLY_FORBIDDEN");
    }

    await this.storyRepo.markAsViewed(storyId, userId);

    const conv = await this.conversationService.getOrCreateDirect(userId, story.userId);

    const storyPreview = toStoryPreview(story);

    const message = await this.messageService.sendMessage(
      userId,
      conv.id,
      { kind: "TEXT", body: dto.body },
      { storyId: story.id, storyPreview },
    );

    await this.cache.deleteBestEffort(storyFeedKey(userId));

    return message;
  }
}

