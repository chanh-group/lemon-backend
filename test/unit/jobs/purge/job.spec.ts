import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRepository } from "../../../../src/domain/note/repository.js";
import type { PurgeableStory, StoryRepository } from "../../../../src/domain/story/repository.js";
import { PurgeJob } from "../../../../src/jobs/purge/job.js";
import { PURGE_BATCH_LIMIT, PURGE_LOCK_TTL_SECS } from "../../../../src/utils/cache/constants.js";
import { CacheError } from "../../../../src/utils/cache/error.js";
import { purgeLockKey } from "../../../../src/utils/cache/keys.js";
import { MemoryCacheService } from "../../../../src/utils/cache/memory.js";
import { StorageError } from "../../../../src/utils/storage/error.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";

type StoryStub = {
  findPurgeable: ReturnType<typeof vi.fn>;
  deleteByIds: ReturnType<typeof vi.fn>;
};

type NoteStub = {
  findExpiredIds: ReturnType<typeof vi.fn>;
  deleteByIds: ReturnType<typeof vi.fn>;
};

type StorageStub = {
  deleteObjects: ReturnType<typeof vi.fn>;
};

function setup(opts?: {
  stories?: PurgeableStory[];
  noteIds?: string[];
  deleted?: string[];
  failed?: string[];
}): {
  job: PurgeJob;
  cache: MemoryCacheService;
  storyRepo: StoryStub;
  noteRepo: NoteStub;
  storage: StorageStub;
} {
  const cache = new MemoryCacheService();
  const storyRepo: StoryStub = {
    findPurgeable: vi.fn().mockResolvedValue(opts?.stories ?? []),
    deleteByIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
  };
  const noteRepo: NoteStub = {
    findExpiredIds: vi.fn().mockResolvedValue(opts?.noteIds ?? []),
    deleteByIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
  };
  const storage: StorageStub = {
    deleteObjects: vi.fn().mockResolvedValue({
      deleted: opts?.deleted ?? [],
      failed: opts?.failed ?? [],
    }),
  };
  const job = new PurgeJob(
    storyRepo as unknown as StoryRepository,
    noteRepo as unknown as NoteRepository,
    storage as unknown as StorageService,
    cache,
  );
  return { job, cache, storyRepo, noteRepo, storage };
}

describe("PurgeJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("purges stories and notes and releases the lock", async () => {
    const { job, cache, storyRepo, noteRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: null }],
      noteIds: ["n1"],
    });
    await job.run();
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s1"]);
    expect(noteRepo.deleteByIds).toHaveBeenCalledWith(["n1"]);
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    await expect(cache.tryAcquireLock(purgeLockKey(), "probe", PURGE_LOCK_TTL_SECS)).resolves.toBe(
      true,
    );
  });

  it("skips all work when another instance holds the lock", async () => {
    const { job, cache, storyRepo, noteRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: null }],
      noteIds: ["n1"],
    });
    await cache.tryAcquireLock(purgeLockKey(), "other", 60);
    await job.run();
    expect(storyRepo.findPurgeable).not.toHaveBeenCalled();
    expect(noteRepo.findExpiredIds).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    await expect(cache.tryAcquireLock(purgeLockKey(), "probe", 60)).resolves.toBe(false);
  });

  it("skips without purging when lock acquisition fails", async () => {
    const { job, cache, storyRepo, noteRepo } = setup({
      stories: [{ id: "s1", objectKey: null }],
      noteIds: ["n1"],
    });
    const releaseSpy = vi.spyOn(cache, "releaseLock");
    vi.spyOn(cache, "tryAcquireLock").mockRejectedValue(
      new CacheError("lock acquire", new Error("down")),
    );
    await job.run();
    expect(storyRepo.findPurgeable).not.toHaveBeenCalled();
    expect(noteRepo.findExpiredIds).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("deletes text stories without calling S3", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: null }],
    });
    await job.run();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s1"]);
  });

  it("keeps failed media rows and deletes confirmed ones plus text rows", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [
        { id: "s1", objectKey: "k1" },
        { id: "s2", objectKey: "k2" },
        { id: "s3", objectKey: null },
      ],
      deleted: ["k1"],
      failed: ["k2"],
    });
    await job.run();
    expect(storage.deleteObjects).toHaveBeenCalledWith(["k1", "k2"]);
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s3", "s1"]);
  });

  it("keeps media rows when storage fails and still purges notes", async () => {
    const { job, storyRepo, noteRepo, storage } = setup({
      stories: [
        { id: "s1", objectKey: "k1" },
        { id: "s2", objectKey: null },
      ],
      noteIds: ["n1"],
    });
    storage.deleteObjects.mockRejectedValue(new StorageError("down"));
    await job.run();
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s2"]);
    expect(noteRepo.deleteByIds).toHaveBeenCalledWith(["n1"]);
  });

  it("re-running after a crash is idempotent", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: "k1" }],
      deleted: ["k1"],
    });
    storyRepo.deleteByIds
      .mockRejectedValueOnce(new Error("crash before row delete"))
      .mockResolvedValueOnce(1);
    await job.run();
    await job.run();
    expect(storage.deleteObjects).toHaveBeenCalledTimes(2);
    expect(storyRepo.deleteByIds).toHaveBeenCalledTimes(2);
  });

  it("limits each phase to PURGE_BATCH_LIMIT", async () => {
    const { job, storyRepo, noteRepo } = setup();
    await job.run();
    expect(storyRepo.findPurgeable).toHaveBeenCalledWith(PURGE_BATCH_LIMIT);
    expect(noteRepo.findExpiredIds).toHaveBeenCalledWith(PURGE_BATCH_LIMIT);
    expect(PURGE_BATCH_LIMIT).toBe(500);
  });

  it("a lock release failure does not throw", async () => {
    const { job, cache } = setup();
    vi.spyOn(cache, "releaseLock").mockRejectedValue(
      new CacheError("lock release", new Error("down")),
    );
    await expect(job.run()).resolves.toBeUndefined();
  });

  it("a story-phase database failure still purges notes", async () => {
    const { job, storyRepo, noteRepo } = setup({ noteIds: ["n1"] });
    storyRepo.findPurgeable.mockRejectedValue(new Error("db down"));
    await expect(job.run()).resolves.toBeUndefined();
    expect(noteRepo.deleteByIds).toHaveBeenCalledWith(["n1"]);
  });
});
