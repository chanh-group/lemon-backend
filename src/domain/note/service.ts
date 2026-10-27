import { Inject, Injectable } from "@nestjs/common";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { NOTE_FEED_TTL_SECS, NOTE_TTL_MS } from "../../utils/cache/constants.js";
import { noteFeedKey } from "../../utils/cache/keys.js";
import { RedisMetricsService } from "../../configs/redis-metrics.js";
import { BusinessError } from "../../utils/errors/business.js";
import { Logger } from "../../utils/logger.js";
import type { UpsertNoteDto } from "./dto/request.js";
import type { NoteResponse, UserNoteFeedResponse } from "./dto/response.js";
import { toNoteResponse } from "./dto/mapper.js";
import { NOTE_REPOSITORY, type NoteRepository } from "./repository.js";

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  constructor(
    @Inject(NOTE_REPOSITORY) private readonly noteRepo: NoteRepository,
    @Inject(CACHE_STORE) private readonly cacheStore: CacheStoreExt,
    private readonly metrics?: RedisMetricsService,
  ) {}

  async upsertNote(userId: string, dto: UpsertNoteDto): Promise<NoteResponse> {
    if (!dto.content || dto.content.trim().length === 0) {
      throw new BusinessError("NOTE_EMPTY_CONTENT");
    }

    const trimmedContent = dto.content.trim();

    const expiresAt = new Date(Date.now() + NOTE_TTL_MS);
    const note = await this.noteRepo.upsert(userId, {
      content: trimmedContent,
      background: dto.background?.trim() || null,
      expiresAt,
    });

    await this.invalidateUserAndFriendFeeds(userId);
    this.logger.log("Note upserted successfully", { userId, noteId: note.id });

    return toNoteResponse(note);
  }

  async getFeed(userId: string): Promise<UserNoteFeedResponse[]> {
    const key = noteFeedKey(userId);
    const [friendIds, cached] = await Promise.all([
      this.noteRepo.getFriendUserIds(userId),
      this.cacheStore.getBestEffort<UserNoteFeedResponse[]>(key),
    ]);
    const visibleUserIds = new Set([userId, ...friendIds]);
    this.metrics?.recordLookup("note_feed", cached === null ? "miss" : "hit");

    if (cached) {
      return cached
        .filter((item) => visibleUserIds.has(item.user.id))
        .map((item) => ({
          ...item,
          note: {
            ...item.note,
            createdAt: new Date(item.note.createdAt),
            updatedAt: new Date(item.note.updatedAt),
            expiresAt: new Date(item.note.expiresAt),
          },
        }));
    }

    const allUserIds = [userId, ...friendIds];
    const rows = await this.noteRepo.findActiveFeedByUserIds(allUserIds);
    const feed: UserNoteFeedResponse[] = rows.map(({ note, user }) => ({
      user,
      note: toNoteResponse(note),
    }));

    await this.cacheStore.setBestEffort(key, feed, NOTE_FEED_TTL_SECS);
    return feed;
  }

  async deleteMyNote(userId: string): Promise<void> {
    const deleted = await this.noteRepo.deleteByUserId(userId);
    if (!deleted) {
      throw new BusinessError("NOTE_NOT_FOUND");
    }

    await this.invalidateUserAndFriendFeeds(userId);
    this.logger.log("Note deleted", { userId });
  }

  private async invalidateUserAndFriendFeeds(userId: string): Promise<void> {
    const friendIds = await this.noteRepo.getFriendUserIds(userId);
    await this.cacheStore.deleteManyBestEffort([
      noteFeedKey(userId),
      ...friendIds.map(noteFeedKey),
    ]);
  }
}
