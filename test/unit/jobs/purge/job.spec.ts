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
  archiveStories: ReturnType<typeof vi.fn>;
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
    archiveStories: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
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
    vi.clearAllMocks();
  });

  it("acquires the distributed lock and cleans up stories and notes", async () => {
    const { job, cache, storyRepo, noteRepo } = setup({
      stories: [{ id: "s1", objectKey: null, userId: "u1" }],
      noteIds: ["n1"],
    });
    const acquireSpy = vi.spyOn(cache, "tryAcquireLock");
    const releaseSpy = vi.spyOn(cache, "releaseLock");

    await job.run();

    expect(acquireSpy).toHaveBeenCalledWith(
      purgeLockKey(),
      expect.any(String),
      PURGE_LOCK_TTL_SECS,
    );
    expect(storyRepo.findPurgeable).toHaveBeenCalled();
    expect(noteRepo.findExpiredIds).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
  });

  it("skips purge when the lock is held by another instance", async () => {
    const { job, cache, storyRepo, noteRepo } = setup();
    vi.spyOn(cache, "tryAcquireLock").mockResolvedValue(false);
    const releaseSpy = vi.spyOn(cache, "releaseLock");

    await job.run();

    expect(storyRepo.findPurgeable).not.toHaveBeenCalled();
    expect(noteRepo.findExpiredIds).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("skips purge when lock acquisition fails and does not release", async () => {
    const { job, cache, storyRepo, noteRepo } = setup();
    const releaseSpy = vi.spyOn(cache, "releaseLock");
    vi.spyOn(cache, "tryAcquireLock").mockRejectedValue(
      new CacheError("lock acquire", new Error("down")),
    );
    await job.run();
    expect(storyRepo.findPurgeable).not.toHaveBeenCalled();
    expect(noteRepo.findExpiredIds).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("archives text stories without calling S3", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: null, userId: "u1" }],
    });
    await job.run();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(storyRepo.archiveStories).toHaveBeenCalledWith(["s1"]);
  });

  it("keeps failed media rows and archives confirmed ones plus text rows", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [
        { id: "s1", objectKey: "k1", userId: "u1" },
        { id: "s2", objectKey: "k2", userId: "u2" },
        { id: "s3", objectKey: null, userId: "u3" },
      ],
      deleted: ["k1"],
      failed: ["k2"],
    });
    await job.run();
    expect(storage.deleteObjects).toHaveBeenCalledWith(["k1", "k2"]);
    expect(storyRepo.archiveStories).toHaveBeenCalledWith(["s3", "s1"]);
  });

  it("keeps media rows when storage fails and still purges notes", async () => {
    const { job, storyRepo, noteRepo, storage } = setup({
      stories: [
        { id: "s1", objectKey: "k1", userId: "u1" },
        { id: "s2", objectKey: null, userId: "u2" },
      ],
      noteIds: ["n1"],
    });
    storage.deleteObjects.mockRejectedValue(new StorageError("down"));
    await job.run();
    expect(storyRepo.archiveStories).toHaveBeenCalledWith(["s2"]);
    expect(noteRepo.deleteByIds).toHaveBeenCalledWith(["n1"]);
  });

  it("re-running after a crash is idempotent", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [{ id: "s1", objectKey: "k1", userId: "u1" }],
      deleted: ["k1"],
    });
    storyRepo.archiveStories
      .mockRejectedValueOnce(new Error("crash before row delete"))
      .mockResolvedValueOnce(1);
    await job.run();
    await job.run();
    expect(storage.deleteObjects).toHaveBeenCalledTimes(2);
    expect(storyRepo.archiveStories).toHaveBeenCalledTimes(2);
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
