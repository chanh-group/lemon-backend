import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  STORY_ALLOWED_IMAGE_MIME,
  STORY_ALLOWED_VIDEO_MIME,
  STORY_FEED_TTL_SECS,
  STORY_MAX_IMAGE_BYTES,
  STORY_MAX_VIDEO_BYTES,
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
import { STORY_SILENT_LIKE_EMOJI, type StoryEmoji, type StoryReactionKind } from "./constants.js";
import type { CreateStoryDto, ReplyStoryDto, UpdateStorySettingsDto } from "./dto/request.js";
import type {
  MyStoryReactionResponse,
  StoryItemResponse,
  StoryReactionResponse,
  StoryViewersListResponse,
  UserStoryFeedResponse,
  UserStorySettingsResponse,
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

    const audienceMode = dto.audienceMode ?? "ALL_FRIENDS";
    let audienceUserIds: string[] | undefined = undefined;

    const friendIds = await this.storyRepo.getFriendUserIds(userId);

    if (audienceMode !== "ALL_FRIENDS" && dto.audienceUserIds) {
      // Validate that all audience IDs are accepted friends and not self
      const friendSet = new Set(friendIds);
      audienceUserIds = Array.from(
        new Set(dto.audienceUserIds.filter((id) => id !== userId && friendSet.has(id))),
      );
    }

    const newStoryData: Omit<NewStory, "createdAt" | "expiresAt"> = {
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
      allowReplies: dto.allowReplies ?? true,
      allowReactions: dto.allowReactions ?? true,
      audienceMode,
    };

    const created = await this.storyRepo.create(newStoryData, audienceUserIds);

    // Invalidate feed cache for affected viewers only
    if (audienceMode === "CUSTOM" && audienceUserIds) {
      await this.cache.deleteManyBestEffort([userId, ...audienceUserIds].map(storyFeedKey));
    } else if (audienceMode === "EXCLUDE" && audienceUserIds) {
      const excludedSet = new Set(audienceUserIds);
      const targetFriendIds = friendIds.filter((id) => !excludedSet.has(id));
      await this.cache.deleteManyBestEffort([userId, ...targetFriendIds].map(storyFeedKey));
    } else {
      await this.cache.deleteManyBestEffort([userId, ...friendIds].map(storyFeedKey));
    }

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

    // Fetch active stories with mute & audience filtering applied for viewer
    const [stories, usersMap] = await Promise.all([
      this.storyRepo.findActiveByUserIds(targetUserIds, userId),
      this.storyRepo.findUsersByIds(targetUserIds),
    ]);

    const storyIds = stories.map((s) => s.id);
    const [viewedStoryIds, userReactionsMap] = await Promise.all([
      this.storyRepo.findViewedStoryIds(userId, storyIds),
      this.storyRepo.findUserReactions(userId, storyIds),
    ]);

    const feed = groupStoriesByUser(usersMap, stories, viewedStoryIds, userReactionsMap);

    await this.cache.setBestEffort(cacheKey, feed, STORY_FEED_TTL_SECS);

    return feed;
  }

  async getStoryById(userId: string, storyId: string): Promise<StoryItemResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    await this.assertCanViewStory(story, userId, "STORY_VIEW_FORBIDDEN");

    const [viewedIds, userReactionsMap, reactionsCountMap] = await Promise.all([
      this.storyRepo.findViewedStoryIds(userId, [storyId]),
      this.storyRepo.findUserReactions(userId, [storyId]),
      this.storyRepo.countReactions([storyId]),
    ]);

    const myReaction = userReactionsMap.get(storyId);

    return toStoryItemResponse(
      story,
      viewedIds.has(storyId),
      myReaction?.emoji ?? null,
      reactionsCountMap.get(storyId) ?? 0,
      myReaction?.kind ?? null,
    );
  }

  async viewStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      return;
    }

    await this.assertCanViewStory(story, userId, "STORY_VIEW_FORBIDDEN");

    const settings = await this.storyRepo.getUserStorySettings(userId);
    const anonymous = !settings.viewedReceiptsEnabled;

    await this.storyRepo.markAsViewed(storyId, userId, anonymous);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async getViewers(
    userId: string,
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<StoryViewersListResponse> {
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

    await this.assertCanViewStory(story, userId, "STORY_REACT_FORBIDDEN");

    if (!story.allowReactions) {
      throw new BusinessError("STORY_INTERACTIONS_DISABLED");
    }

    const settings = await this.storyRepo.getUserStorySettings(userId);
    const anonymous = !settings.viewedReceiptsEnabled;

    const { reaction, isNew } = await this.storyRepo.addReactionWithView(
      storyId,
      userId,
      emoji,
      "REACTION",
      anonymous,
    );

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
        kind: "REACTION",
        createdAt: reaction.createdAt,
      };
      this.realtimeService.emitStoryReaction(story.userId, payload);
      this.realtimeService.emitStoryReaction(userId, payload);
    }

    if (isNew) {
      await this.mirrorReactionToDirectConversation(userId, story, emoji);
    }

    return {
      storyId: reaction.storyId,
      emoji: reaction.emoji,
      kind: reaction.kind,
      createdAt: reaction.createdAt,
    };
  }

  async likeStory(userId: string, storyId: string): Promise<MyStoryReactionResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REACT_OWN_STORY");
    }

    await this.assertCanViewStory(story, userId, "STORY_REACT_FORBIDDEN");

    if (!story.allowReactions) {
      throw new BusinessError("STORY_INTERACTIONS_DISABLED");
    }

    const settings = await this.storyRepo.getUserStorySettings(userId);
    const anonymous = !settings.viewedReceiptsEnabled;

    const { reaction } = await this.storyRepo.addReactionWithView(
      storyId,
      userId,
      STORY_SILENT_LIKE_EMOJI,
      "LIKE",
      anonymous,
    );

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
        emoji: STORY_SILENT_LIKE_EMOJI,
        kind: "LIKE",
        createdAt: reaction.createdAt,
      };
      this.realtimeService.emitStoryReaction(story.userId, payload);
      this.realtimeService.emitStoryReaction(userId, payload);
    }

    // Silent like: do NOT mirror to direct conversation!

    return {
      storyId: reaction.storyId,
      emoji: reaction.emoji,
      kind: reaction.kind,
      createdAt: reaction.createdAt,
    };
  }

  async unlikeStory(userId: string, storyId: string): Promise<void> {
    return this.unreactStory(userId, storyId);
  }

  private async mirrorReactionToDirectConversation(
    userId: string,
    story: Story,
    emoji: string,
  ): Promise<void> {
    try {
      const conv = await this.conversationService.getOrCreateDirect(userId, story.userId);
      await this.messageService.sendMessage(
        userId,
        conv.id,
        { kind: "TEXT", body: emoji },
        { kind: "STORY_REACTION", storyId: story.id, storyPreview: toStoryPreview(story) },
      );
    } catch (err) {
      this.logger.warn("Failed to mirror the story reaction into the direct conversation", {
        storyId: story.id,
        userId,
        err,
      });
    }
  }

  async unreactStory(userId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REACT_OWN_STORY");
    }

    await this.assertCanViewStory(story, userId, "STORY_REACT_FORBIDDEN");

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
    kind?: StoryReactionKind,
  ): Promise<CursorPage<StoryReactionResponse>> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId !== userId) {
      throw new BusinessError("STORY_REACTIONS_FORBIDDEN");
    }

    return this.storyRepo.findReactionsByStoryId(storyId, cursor, limit, kind);
  }

  async replyStory(userId: string, storyId: string, dto: ReplyStoryDto): Promise<MessageResponse> {
    const story = await this.storyRepo.findActiveById(storyId);
    if (!story) {
      throw new BusinessError("STORY_NOT_FOUND");
    }

    if (story.userId === userId) {
      throw new BusinessError("CANNOT_REPLY_OWN_STORY");
    }

    await this.assertCanViewStory(story, userId, "STORY_REPLY_FORBIDDEN");

    if (!story.allowReplies) {
      throw new BusinessError("STORY_INTERACTIONS_DISABLED");
    }

    const settings = await this.storyRepo.getUserStorySettings(userId);
    const anonymous = !settings.viewedReceiptsEnabled;

    const [, conv] = await Promise.all([
      this.storyRepo.markAsViewed(storyId, userId, anonymous),
      this.conversationService.getOrCreateDirect(userId, story.userId),
    ]);
    const storyPreview = toStoryPreview(story);

    const message = await this.messageService.sendMessage(
      userId,
      conv.id,
      { kind: "TEXT", body: dto.body },
      { kind: "STORY_REPLY", storyId: story.id, storyPreview },
    );

    await this.cache.deleteBestEffort(storyFeedKey(userId));

    return message;
  }

  // Settings
  async getStorySettings(userId: string): Promise<UserStorySettingsResponse> {
    const s = await this.storyRepo.getUserStorySettings(userId);
    return {
      viewedReceiptsEnabled: s.viewedReceiptsEnabled,
      archiveEnabled: s.archiveEnabled,
      archiveDurationSecs: s.archiveDurationSecs,
    };
  }

  async updateStorySettings(
    userId: string,
    dto: UpdateStorySettingsDto,
  ): Promise<UserStorySettingsResponse> {
    const s = await this.storyRepo.upsertUserStorySettings(userId, dto);
    return {
      viewedReceiptsEnabled: s.viewedReceiptsEnabled,
      archiveEnabled: s.archiveEnabled,
      archiveDurationSecs: s.archiveDurationSecs,
    };
  }

  // Mutes
  async muteAuthor(userId: string, authorId: string): Promise<void> {
    if (userId === authorId) {
      throw new BusinessError("CANNOT_MUTE_SELF");
    }
    await this.storyRepo.muteAuthor(userId, authorId);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async unmuteAuthor(userId: string, authorId: string): Promise<void> {
    await this.storyRepo.unmuteAuthor(userId, authorId);
    await this.cache.deleteBestEffort(storyFeedKey(userId));
  }

  async getMutedAuthorIds(userId: string): Promise<string[]> {
    return this.storyRepo.getMutedAuthorIds(userId);
  }

  // Archives
  async getArchivedStories(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryItemResponse>> {
    return this.storyRepo.findArchivedStoriesByUserId(userId, cursor, limit);
  }

  private async assertCanViewStory(
    story: Story,
    viewerId: string,
    forbiddenCode:
      | "STORY_VIEW_FORBIDDEN"
      | "STORY_REACT_FORBIDDEN"
      | "STORY_REPLY_FORBIDDEN" = "STORY_VIEW_FORBIDDEN",
  ): Promise<void> {
    if (story.userId === viewerId) return;

    if (story.audienceMode === "ALL_FRIENDS") {
      const isFriend = await this.storyRepo.isAcceptedFriend(story.userId, viewerId);
      if (!isFriend) {
        throw new BusinessError(forbiddenCode);
      }
      return;
    }

    if (story.audienceMode === "CUSTOM") {
      const isAudience = await this.storyRepo.isStoryAudience(story.id, viewerId);
      if (!isAudience) {
        throw new BusinessError(forbiddenCode);
      }
      return;
    }

    if (story.audienceMode === "EXCLUDE") {
      const isFriend = await this.storyRepo.isAcceptedFriend(story.userId, viewerId);
      if (!isFriend) {
        throw new BusinessError(forbiddenCode);
      }
      const isExcluded = await this.storyRepo.isStoryAudience(story.id, viewerId);
      if (isExcluded) {
        throw new BusinessError(forbiddenCode);
      }
      return;
    }
  }
}
