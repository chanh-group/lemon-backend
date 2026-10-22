import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { NOTE_REPOSITORY } from "../../domain/note/repository.js";
import type { NoteRepository } from "../../domain/note/repository.js";
import { STORY_REPOSITORY } from "../../domain/story/repository.js";
import type { PurgeableStory } from "../../domain/story/repository.js";
import type { StoryRepository } from "../../domain/story/repository.js";
import {
  PURGE_BATCH_LIMIT,
  PURGE_CRON_EXPRESSION,
  PURGE_LOCK_TTL_SECS,
} from "../../utils/cache/constants.js";
import { purgeLockKey } from "../../utils/cache/keys.js";
import { CACHE_STORE } from "../../utils/cache/store.js";
import type { CacheStore } from "../../utils/cache/store.js";
import { STORAGE_SERVICE } from "../../utils/storage/store.js";
import type { StorageService } from "../../utils/storage/store.js";

type StoryPurgeCounts = { stories: number; objects: number };

@Injectable()
export class PurgeJob {
  private readonly logger = new Logger(PurgeJob.name);

  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepo: StoryRepository,
    @Inject(NOTE_REPOSITORY)
    private readonly noteRepo: NoteRepository,
    @Inject(STORAGE_SERVICE)
    private readonly storage: StorageService,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
  ) {}

  @Cron(PURGE_CRON_EXPRESSION)
  async run(): Promise<void> {
    const startedAt = Date.now();
    const key = purgeLockKey();
    const token = randomUUID();
    let acquired: boolean;
    try {
      acquired = await this.cache.tryAcquireLock(key, token, PURGE_LOCK_TTL_SECS);
    } catch (err) {
      this.logger.warn("Purge skipped: lock acquisition failed", { err });
      return;
    }
    if (!acquired) {
      this.logger.debug("Purge skipped: lock held by another instance");
      return;
    }
    try {
      const { stories, objects } = await this.purgeStories();
      const notes = await this.purgeNotes();
      this.logger.log("Purge completed", {
        stories,
        objects,
        notes,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      try {
        await this.cache.releaseLock(key, token);
      } catch (err) {
        this.logger.warn("Purge lock release failed", { err });
      }
    }
  }

  private async purgeStories(): Promise<StoryPurgeCounts> {
    try {
      const rows = await this.storyRepo.findPurgeable(PURGE_BATCH_LIMIT);
      if (rows.length === 0) return { stories: 0, objects: 0 };
      const media = rows.filter(
        (row): row is PurgeableStory & { objectKey: string } => row.objectKey !== null,
      );
      const textIds = rows.filter((row) => row.objectKey === null).map((row) => row.id);
      let deletedKeys = new Set<string>();
      if (media.length > 0) {
        try {
          const result = await this.storage.deleteObjects(media.map((row) => row.objectKey));
          deletedKeys = new Set(result.deleted);
          if (result.failed.length > 0) {
            this.logger.warn("Purge: some S3 objects failed to delete", {
              failed: result.failed.length,
            });
          }
        } catch (err) {
          this.logger.warn("Purge: S3 deletion failed, media stories kept for retry", { err });
        }
      }
      const confirmedIds = media
        .filter((row) => deletedKeys.has(row.objectKey))
        .map((row) => row.id);
      const ids = [...textIds, ...confirmedIds];
      if (ids.length === 0) return { stories: 0, objects: 0 };
      const stories = await this.storyRepo.archiveStories(ids);
      return { stories, objects: confirmedIds.length };
    } catch (err) {
      this.logger.error("Purge story phase failed", { err });
      return { stories: 0, objects: 0 };
    }
  }

  private async purgeNotes(): Promise<number> {
    try {
      const ids = await this.noteRepo.findExpiredIds(PURGE_BATCH_LIMIT);
      if (ids.length === 0) return 0;
      return await this.noteRepo.deleteByIds(ids);
    } catch (err) {
      this.logger.error("Purge note phase failed", { err });
      return 0;
    }
  }
}
