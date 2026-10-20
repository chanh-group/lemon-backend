import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CacheStoreExt } from "../../../../src/utils/cache/store.js";
import type { NoteRepository } from "../../../../src/domain/note/repository.js";
import { NoteService } from "../../../../src/domain/note/service.js";
import type { Note } from "../../../../src/domain/note/schema.js";
import type { UserSummary } from "../../../../src/domain/user/dto/response.js";
import type { UserNoteFeedResponse } from "../../../../src/domain/note/dto/response.js";

describe("NoteService", () => {
  let service: NoteService;

  let upsertMock: Mock<
    (
      userId: string,
      data: { content: string; background?: string | null; expiresAt: Date },
    ) => Promise<Note>
  >;
  let findActiveByUserIdMock: Mock<(userId: string) => Promise<Note | null>>;
  let findActiveByUserIdsMock: Mock<(userIds: string[]) => Promise<Note[]>>;
  let findUsersByIdsMock: Mock<(userIds: string[]) => Promise<Map<string, UserSummary>>>;
  let getFriendUserIdsMock: Mock<(userId: string) => Promise<string[]>>;
  let deleteByUserIdMock: Mock<(userId: string) => Promise<boolean>>;
  let findExpiredIdsMock: Mock<(limit: number) => Promise<string[]>>;
  let deleteByIdsMock: Mock<(ids: string[]) => Promise<number>>;

  let getBestEffortMock: Mock<(key: string) => Promise<unknown>>;
  let setBestEffortMock: Mock<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>;
  let deleteManyBestEffortMock: Mock<(keys: string[]) => Promise<void>>;

  const mockNote: Note = {
    id: "0193a2b1-0000-7000-8000-000000000002",
    userId: "user-1",
    content: "Sunny day note",
    background: "#ffcc00",
    createdAt: new Date("2026-10-15T00:00:00Z"),
    expiresAt: new Date("2026-10-16T00:00:00Z"),
  };

  beforeEach(() => {
    upsertMock = vi
      .fn<
        (
          userId: string,
          data: { content: string; background?: string | null; expiresAt: Date },
        ) => Promise<Note>
      >()
      .mockImplementation((userId, data) =>
        Promise.resolve({
          id: "note-new-id",
          userId,
          content: data.content,
          background: data.background ?? null,
          createdAt: new Date(),
          expiresAt: data.expiresAt,
        }),
      );
    findActiveByUserIdMock = vi
      .fn<(userId: string) => Promise<Note | null>>()
      .mockResolvedValue(mockNote);
    findActiveByUserIdsMock = vi
      .fn<(userIds: string[]) => Promise<Note[]>>()
      .mockResolvedValue([mockNote]);
    findUsersByIdsMock = vi
      .fn<(userIds: string[]) => Promise<Map<string, UserSummary>>>()
      .mockResolvedValue(
        new Map([
          [
            "user-1",
            {
              id: "user-1",
              username: "user1",
              fullName: "User One",
              avatarUrl: null,
            },
          ],
        ]),
      );
    getFriendUserIdsMock = vi
      .fn<(userId: string) => Promise<string[]>>()
      .mockResolvedValue(["friend-1", "friend-2"]);
    deleteByUserIdMock = vi.fn<(userId: string) => Promise<boolean>>().mockResolvedValue(true);
    findExpiredIdsMock = vi.fn<(limit: number) => Promise<string[]>>().mockResolvedValue([]);
    deleteByIdsMock = vi.fn<(ids: string[]) => Promise<number>>().mockResolvedValue(0);

    getBestEffortMock = vi.fn<(key: string) => Promise<unknown>>().mockResolvedValue(null);
    setBestEffortMock = vi
      .fn<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    deleteManyBestEffortMock = vi
      .fn<(keys: string[]) => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockRepo: NoteRepository = {
      upsert: upsertMock,
      findActiveByUserId: findActiveByUserIdMock,
      findActiveByUserIds: findActiveByUserIdsMock,
      findUsersByIds: findUsersByIdsMock,
      getFriendUserIds: getFriendUserIdsMock,
      deleteByUserId: deleteByUserIdMock,
      findExpiredIds: findExpiredIdsMock,
      deleteByIds: deleteByIdsMock,
    };

    const mockCache = {
      getBestEffort: getBestEffortMock,
      setBestEffort: setBestEffortMock,
      deleteManyBestEffort: deleteManyBestEffortMock,
    } as unknown as CacheStoreExt;

    service = new NoteService(mockRepo, mockCache);
  });

  describe("upsertNote", () => {
    it("upserts note with valid content and invalidates feeds", async () => {
      const result = await service.upsertNote("user-1", {
        content: "Hello world",
        background: "#ffffff",
      });

      expect(result.id).toBe("note-new-id");
      expect(result.content).toBe("Hello world");
      expect(upsertMock).toHaveBeenCalledTimes(1);
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "notes:feed:user-1",
        "notes:feed:friend-1",
        "notes:feed:friend-2",
      ]);
    });

    it("throws NOTE_EMPTY_CONTENT if content is empty or whitespace", async () => {
      await expect(service.upsertNote("user-1", { content: "" })).rejects.toMatchObject({
        code: "NOTE_EMPTY_CONTENT",
      });
      await expect(service.upsertNote("user-1", { content: "    " })).rejects.toMatchObject({
        code: "NOTE_EMPTY_CONTENT",
      });
    });
  });

  describe("getFeed", () => {
    it("returns cached feed when cache hit occurs", async () => {
      const cachedFeed: UserNoteFeedResponse[] = [
        {
          user: { id: "user-1", username: "u1", fullName: "User 1", avatarUrl: null },
          note: {
            id: "n1",
            userId: "user-1",
            content: "cached note",
            background: null,
            createdAt: new Date("2026-10-15T00:00:00Z"),
            expiresAt: new Date("2026-10-16T00:00:00Z"),
          },
        },
      ];
      getFriendUserIdsMock.mockResolvedValueOnce(["user-1"]);
      getBestEffortMock.mockResolvedValueOnce(cachedFeed);

      const result = await service.getFeed("user-viewer");
      expect(result).toHaveLength(1);
      expect(result[0].note.content).toBe("cached note");
      expect(findActiveByUserIdsMock).not.toHaveBeenCalled();
    });

    it("revives Date objects from JSON cached feed", async () => {
      const rawCached = [
        {
          user: { id: "user-1", username: "u1", fullName: "User 1", avatarUrl: null },
          note: {
            id: "n1",
            userId: "user-1",
            content: "cached note",
            background: null,
            createdAt: "2026-10-15T00:00:00.000Z",
            expiresAt: "2026-10-16T00:00:00.000Z",
          },
        },
      ];
      getFriendUserIdsMock.mockResolvedValueOnce(["user-1"]);
      getBestEffortMock.mockResolvedValueOnce(rawCached);

      const result = await service.getFeed("user-viewer");
      expect(result[0].note.createdAt).toBeInstanceOf(Date);
      expect(result[0].note.expiresAt).toBeInstanceOf(Date);
    });

    it("queries repository, groups by user, and sets cache on cache miss", async () => {
      const result = await service.getFeed("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].user.id).toBe("user-1");
      expect(result[0].note.id).toBe(mockNote.id);
      expect(findActiveByUserIdsMock).toHaveBeenCalledTimes(1);
      expect(setBestEffortMock).toHaveBeenCalledWith("notes:feed:user-1", expect.any(Array), 60);
    });

    it("falls back to unknown profile if user is not in users map", async () => {
      findUsersByIdsMock.mockResolvedValueOnce(new Map());

      const result = await service.getFeed("user-1");
      expect(result[0].user.id).toBe("user-1");
      expect(result[0].user.username).toBe("unknown");
    });
  });

  describe("deleteMyNote", () => {
    it("deletes active note and invalidates feed cache", async () => {
      await service.deleteMyNote("user-1");

      expect(deleteByUserIdMock).toHaveBeenCalledWith("user-1");
      expect(deleteManyBestEffortMock).toHaveBeenCalledWith([
        "notes:feed:user-1",
        "notes:feed:friend-1",
        "notes:feed:friend-2",
      ]);
    });

    it("throws NOTE_NOT_FOUND if no active note was deleted", async () => {
      deleteByUserIdMock.mockResolvedValueOnce(false);

      await expect(service.deleteMyNote("user-1")).rejects.toMatchObject({
        code: "NOTE_NOT_FOUND",
      });
    });
  });
});
