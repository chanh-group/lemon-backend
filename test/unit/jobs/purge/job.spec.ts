import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRepository } from "../../../../src/domain/note/repository.js";
import type { ConversationRepository } from "../../../../src/domain/conversation/repository.js";
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
  avatarJobs?: Array<{
    id: string;
    conversationId: string | null;
    objectKey: string;
    attempts: number;
  }>;
}): {
  job: PurgeJob;
  cache: MemoryCacheService;
  storyRepo: StoryStub;
  noteRepo: NoteStub;
  storage: StorageStub;
  conversationRepo: {
    findPendingAvatarCleanupJobs: ReturnType<typeof vi.fn>;
    getGroupAvatarUrls: ReturnType<typeof vi.fn>;
    completeAvatarCleanupJobs: ReturnType<typeof vi.fn>;
    failAvatarCleanupJobs: ReturnType<typeof vi.fn>;
  };
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
  const conversationRepo = {
    findPendingAvatarCleanupJobs: vi.fn().mockResolvedValue(opts?.avatarJobs ?? []),
    getGroupAvatarUrls: vi.fn().mockResolvedValue(new Map()),
    completeAvatarCleanupJobs: vi.fn().mockResolvedValue(0),
    failAvatarCleanupJobs: vi.fn().mockResolvedValue(undefined),
  };
  const job = new PurgeJob(
    storyRepo as unknown as StoryRepository,
    noteRepo as unknown as NoteRepository,
    storage as unknown as StorageService,
    cache,
    { purgeExpired: vi.fn().mockResolvedValue(0) } as never,
    conversationRepo as unknown as ConversationRepository,
  );
  return { job, cache, storyRepo, noteRepo, storage, conversationRepo };
}

describe("PurgeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires the distributed lock and cleans up stories and notes", async () => {
    const { job, cache, storyRepo, noteRepo } = setup({
      stories: [
        {
          id: "s1",
          objectKey: null,
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: true,
        },
      ],
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
      stories: [
        {
          id: "s1",
          objectKey: null,
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: true,
        },
      ],
    });
    await job.run();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(storyRepo.archiveStories).toHaveBeenCalledWith(["s1"]);
  });

  it("archives enabled stories and deletes disabled stories only after storage confirms", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [
        {
          id: "s1",
          objectKey: "k1",
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: true,
        },
        {
          id: "s2",
          objectKey: "k2",
          userId: "u2",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: false,
        },
        {
          id: "s3",
          objectKey: null,
          userId: "u3",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: true,
        },
      ],
      deleted: ["k2"],
    });
    await job.run();
    expect(storage.deleteObjects).toHaveBeenCalledWith(["k2"]);
    expect(storyRepo.archiveStories).toHaveBeenCalledWith(["s1", "s3"]);
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s2"]);
  });

  it("keeps media rows when storage fails and still purges notes", async () => {
    const { job, storyRepo, noteRepo, storage } = setup({
      stories: [
        {
          id: "s1",
          objectKey: "k1",
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: false,
        },
        {
          id: "s2",
          objectKey: null,
          userId: "u2",
          archivedAt: null,
          deletedAt: new Date(),
          archiveEnabled: true,
        },
      ],
      noteIds: ["n1"],
    });
    storage.deleteObjects.mockRejectedValue(new StorageError("down"));
    await job.run();
    expect(storyRepo.archiveStories).not.toHaveBeenCalled();
    expect(storyRepo.deleteByIds).toHaveBeenCalledWith(["s2"]);
    expect(noteRepo.deleteByIds).toHaveBeenCalledWith(["n1"]);
  });

  it("re-running after a crash is idempotent", async () => {
    const { job, storyRepo, storage } = setup({
      stories: [
        {
          id: "s1",
          objectKey: "k1",
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: false,
        },
      ],
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

  it("keeps all avatar cleanup jobs when the batch reference lookup fails", async () => {
    const { job, storage, conversationRepo } = setup({
      avatarJobs: [
        {
          id: "job-1",
          conversationId: "group-1",
          objectKey: "group-avatars/group-1/photo.png",
          attempts: 0,
        },
      ],
    });
    conversationRepo.getGroupAvatarUrls.mockRejectedValue(new Error("database unavailable"));

    await job.run();

    expect(storage.deleteObjects).not.toHaveBeenCalled();
    expect(conversationRepo.completeAvatarCleanupJobs).not.toHaveBeenCalled();
    expect(conversationRepo.failAvatarCleanupJobs).not.toHaveBeenCalled();
  });

  it("looks up every avatar reference once and cancels jobs still in use", async () => {
    const { job, storage, conversationRepo } = setup({
      avatarJobs: [
        {
          id: "job-1",
          conversationId: "group-1",
          objectKey: "group-avatars/group-1/0193a2b1-0000-7000-8000-0000000000a1.png",
          attempts: 0,
        },
        {
          id: "job-2",
          conversationId: "group-2",
          objectKey: "group-avatars/group-2/0193a2b1-0000-7000-8000-0000000000b1.png",
          attempts: 1,
        },
      ],
      deleted: ["group-avatars/group-2/0193a2b1-0000-7000-8000-0000000000b1.png"],
    });
    conversationRepo.getGroupAvatarUrls.mockResolvedValue(
      new Map([
        [
          "group-1",
          "http://localhost:3000/api/files/group-avatars/group-1/0193a2b1-0000-7000-8000-0000000000a1.png",
        ],
        [
          "group-2",
          "http://localhost:3000/api/files/group-avatars/group-2/0193a2b1-0000-7000-8000-0000000000c1.png",
        ],
      ]),
    );

    await job.run();

    expect(conversationRepo.getGroupAvatarUrls).toHaveBeenCalledTimes(1);
    expect(conversationRepo.getGroupAvatarUrls).toHaveBeenCalledWith(["group-1", "group-2"]);
    expect(storage.deleteObjects).toHaveBeenCalledWith([
      "group-avatars/group-2/0193a2b1-0000-7000-8000-0000000000b1.png",
    ]);
    expect(conversationRepo.completeAvatarCleanupJobs).toHaveBeenNthCalledWith(1, ["job-1"]);
    expect(conversationRepo.completeAvatarCleanupJobs).toHaveBeenNthCalledWith(2, ["job-2"]);
    expect(conversationRepo.failAvatarCleanupJobs).not.toHaveBeenCalled();
  });

  it("records S3 deletion failures for all jobs in one batch", async () => {
    const { job, conversationRepo } = setup({
      avatarJobs: [
        {
          id: "job-1",
          conversationId: "group-1",
          objectKey: "group-avatars/group-1/a.png",
          attempts: 0,
        },
        {
          id: "job-2",
          conversationId: "group-2",
          objectKey: "group-avatars/group-2/b.png",
          attempts: 2,
        },
      ],
      failed: ["group-avatars/group-1/a.png", "group-avatars/group-2/b.png"],
    });

    await job.run();

    expect(conversationRepo.failAvatarCleanupJobs).toHaveBeenCalledTimes(1);
    expect(conversationRepo.failAvatarCleanupJobs).toHaveBeenCalledWith([
      {
        id: "job-1",
        attempts: 0,
        error: "Storage deleteObjects reported failed",
      },
      {
        id: "job-2",
        attempts: 2,
        error: "Storage deleteObjects reported failed",
      },
    ]);
  });
});
