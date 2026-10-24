import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { StoryPgRepository } from "../../../../src/domain/story/pg.js";
import { encodeReactionCursor } from "../../../../src/domain/story/dto/mapper.js";
import { stories, storyReactions, storyViews } from "../../../../src/domain/story/schema.js";
import { friendships } from "../../../../src/domain/friend/schema.js";

function makeDb(rows: unknown[] = []) {
  const limitMock = vi.fn<(limit: number) => Promise<unknown>>();
  const groupByMock = vi.fn<(column: unknown) => Promise<unknown>>();
  const orderByMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
  const whereMock = vi.fn<(condition: SQL) => unknown>(() =>
    Object.assign(Promise.resolve(rows), {
      orderBy: orderByMock,
      limit: limitMock,
      groupBy: groupByMock,
    }),
  );
  const joinMock = vi.fn(() => ({
    where: whereMock,
    leftJoin: vi.fn(() => ({ where: whereMock })),
  }));
  const fromMock = vi.fn(() => ({
    where: whereMock,
    innerJoin: joinMock,
    leftJoin: vi.fn(() => ({ where: whereMock })),
  }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const returningMock = vi.fn();
  const onConflictMock = vi.fn<(conflict: unknown) => unknown>(() => ({
    returning: returningMock,
  }));
  const onConflictDoNothingMock = vi.fn(() => Promise.resolve());
  const valuesMock = vi.fn(() => ({
    onConflictDoUpdate: onConflictMock,
    onConflictDoNothing: onConflictDoNothingMock,
  }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));
  const deleteWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ returning: returningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
  const updateSetMock = vi.fn(() => ({ where: vi.fn(() => ({ returning: returningMock })) }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const tx = { select: selectMock, insert: insertMock, update: updateMock };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    select: selectMock,
    delete: deleteMock,
    insert: insertMock,
    update: updateMock,
    transaction: transactionMock,
  } as unknown as DrizzleDb;
  return {
    db,
    selectMock,
    whereMock,
    orderByMock,
    groupByMock,
    limitMock,
    deleteMock,
    deleteWhereMock,
    insertMock,
    valuesMock,
    onConflictMock,
    returningMock,
    transactionMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL): string => dialect.sqlToQuery(condition).sql;

describe("StoryPgRepository purge queries", () => {
  describe("isAcceptedFriend", () => {
    it("checks the canonical pair and accepted status with a bounded lookup", async () => {
      const { db, selectMock, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([{ id: "friendship-1" }]);
      const repo = new StoryPgRepository(db);

      await expect(repo.isAcceptedFriend("z-user", "a-user")).resolves.toBe(true);
      expect(selectMock).toHaveBeenCalledWith({ id: friendships.id });
      expect(limitMock).toHaveBeenCalledWith(1);
      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"friendships"."user_low" = $1');
      expect(whereSql).toContain('"friendships"."user_high" = $2');
      expect(whereSql).toContain('"friendships"."status" = $3');
    });
  });

  describe("findPurgeable", () => {
    it("findPurgeable selects id and object_key with the batch limit", async () => {
      const { db, selectMock, whereMock, orderByMock, limitMock } = makeDb();
      const rows = [{ id: "s1", objectKey: "k1", userId: "u1" }];
      limitMock.mockResolvedValue(rows);
      const repo = new StoryPgRepository(db);

      const result = await repo.findPurgeable(500);

      expect(selectMock).toHaveBeenCalledWith({
        id: stories.id,
        objectKey: stories.objectKey,
        userId: stories.userId,
      });
      expect(limitMock).toHaveBeenCalledWith(500);
      expect(result).toEqual(rows);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"stories"."expires_at" < now()');
      expect(whereSql).toContain('"stories"."deleted_at" is not null');
      expect(whereSql).toContain('"stories"."archived_at" is null');

      const orderBySql = render(orderByMock.mock.calls[0][0]);
      expect(orderBySql).toContain('"stories"."expires_at" asc');
    });
  });

  describe("deleteByIds", () => {
    it("deleteByIds deletes exactly the given ids and returns the count", async () => {
      const { db, deleteMock, deleteWhereMock, returningMock } = makeDb();
      returningMock.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
      const repo = new StoryPgRepository(db);

      const result = await repo.deleteByIds(["s1", "s2"]);

      expect(result).toBe(2);
      expect(deleteMock).toHaveBeenCalledWith(stories);

      const whereSql = render(deleteWhereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"stories"."id" in (');
    });

    it("deleteByIds with an empty list performs no query", async () => {
      const { db, deleteMock } = makeDb();
      const repo = new StoryPgRepository(db);

      const result = await repo.deleteByIds([]);

      expect(result).toBe(0);
      expect(deleteMock).not.toHaveBeenCalled();
    });
  });

  describe("reaction queries", () => {
    it("addReactionWithView stores the view and the reaction in one transaction", async () => {
      const { db, insertMock, valuesMock, onConflictMock, returningMock, transactionMock } =
        makeDb();
      const createdAt = new Date("2026-10-14T02:00:00Z");
      returningMock.mockResolvedValue([
        {
          storyId: "s1",
          userId: "u1",
          emoji: "🔥",
          kind: "REACTION",
          createdAt,
          updatedAt: createdAt,
          isNew: true,
        },
      ]);
      const repo = new StoryPgRepository(db);

      const result = await repo.addReactionWithView("s1", "u1", "🔥");

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenCalledWith(storyViews);
      expect(insertMock).toHaveBeenCalledWith(storyReactions);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ storyId: "s1", userId: "u1", emoji: "🔥" }),
      );
      expect(onConflictMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: [storyReactions.storyId, storyReactions.userId],
        }),
      );
      expect(result.isNew).toBe(true);
      expect(result.reaction).toEqual({
        storyId: "s1",
        userId: "u1",
        emoji: "🔥",
        kind: "REACTION",
        createdAt,
        updatedAt: createdAt,
      });
    });

    it("addReactionWithView keeps the original created_at when the emoji changes", async () => {
      const { db, onConflictMock, returningMock } = makeDb();
      returningMock.mockResolvedValue([
        {
          storyId: "s1",
          userId: "u1",
          emoji: "😂",
          kind: "REACTION",
          createdAt: new Date(),
          updatedAt: new Date(),
          isNew: false,
        },
      ]);
      const repo = new StoryPgRepository(db);

      await repo.addReactionWithView("s1", "u1", "😂");

      const conflict = onConflictMock.mock.calls[0][0] as {
        set: Record<string, unknown>;
      };
      expect(conflict.set).not.toHaveProperty("createdAt");
      expect(conflict.set).toHaveProperty("updatedAt");
    });

    it("addReactionWithView reports an updated row when the reaction already existed", async () => {
      const { db, returningMock } = makeDb();
      returningMock.mockResolvedValue([
        {
          storyId: "s1",
          userId: "u1",
          emoji: "😂",
          kind: "REACTION",
          createdAt: new Date(),
          updatedAt: new Date(),
          isNew: false,
        },
      ]);
      const repo = new StoryPgRepository(db);

      const result = await repo.addReactionWithView("s1", "u1", "😂");

      expect(result.isNew).toBe(false);
      expect(result.reaction.emoji).toBe("😂");
    });

    it("deleteReaction returns true when row is deleted", async () => {
      const { db, returningMock } = makeDb();
      returningMock.mockResolvedValue([{ storyId: "s1" }]);
      const repo = new StoryPgRepository(db);

      const result = await repo.deleteReaction("s1", "u1");
      expect(result).toBe(true);
    });

    it("deleteReaction returns false when nothing is deleted", async () => {
      const { db, returningMock } = makeDb();
      returningMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);

      const result = await repo.deleteReaction("s1", "u1");
      expect(result).toBe(false);
    });

    it("findReactionsByStoryId maps the rows and bounds the query to one page", async () => {
      const { db, selectMock, limitMock } = makeDb();
      const createdAt = new Date("2026-10-14T01:00:00Z");
      limitMock.mockResolvedValue([
        {
          userId: "u1",
          username: "f1",
          fullName: "F1",
          avatarUrl: null,
          emoji: "❤️",
          kind: "REACTION",
          createdAt,
        },
      ]);
      const repo = new StoryPgRepository(db);

      const page = await repo.findReactionsByStoryId("s1", undefined, 20);

      expect(selectMock).toHaveBeenCalledWith(
        expect.objectContaining({ emoji: storyReactions.emoji }),
      );
      expect(limitMock).toHaveBeenCalledWith(21);
      expect(page.hasMore).toBe(false);
      expect(page.items).toEqual([
        {
          user: { id: "u1", username: "f1", fullName: "F1", avatarUrl: null },
          emoji: "❤️",
          kind: "REACTION",
          createdAt,
        },
      ]);
    });

    it("findReactionsByStoryId pages with the cursor of the previous item", async () => {
      const { db, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);

      await repo.findReactionsByStoryId("s1", "u1", 20);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain("SELECT sr.created_at FROM story_reactions sr");
      expect(whereSql).toContain('"story_reactions"."created_at" <');
      expect(whereSql).toContain('"users"."id" <');
    });

    it("findReactionsByStoryId pages with an encoded cursor without subquery", async () => {
      const { db, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);
      const encoded = encodeReactionCursor(new Date("2026-10-24T18:00:00.000Z"), "u1");

      await repo.findReactionsByStoryId("s1", encoded, 20);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).not.toContain("SELECT sr.created_at FROM story_reactions sr");
      expect(whereSql).toContain('"story_reactions"."created_at" <');
      expect(whereSql).toContain('"users"."id" <');
    });

    it("findUserReactions returns empty map when storyIds is empty", async () => {
      const { db, selectMock } = makeDb();
      const repo = new StoryPgRepository(db);

      const result = await repo.findUserReactions("u1", []);
      expect(result.size).toBe(0);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("findUserReactions maps rows to a story id -> detail map", async () => {
      const { db } = makeDb([{ storyId: "s1", emoji: "🔥", kind: "REACTION" }]);
      const repo = new StoryPgRepository(db);

      const result = await repo.findUserReactions("u1", ["s1"]);

      expect(result.get("s1")).toEqual({ emoji: "🔥", kind: "REACTION" });
    });

    it("countReactions returns empty map when storyIds is empty", async () => {
      const { db, selectMock } = makeDb();
      const repo = new StoryPgRepository(db);

      const result = await repo.countReactions([]);
      expect(result.size).toBe(0);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it("countReactions groups by story and returns numeric counts", async () => {
      const { db, groupByMock } = makeDb();
      groupByMock.mockResolvedValue([{ storyId: "s1", count: 3 }]);
      const repo = new StoryPgRepository(db);

      const result = await repo.countReactions(["s1"]);

      expect(groupByMock).toHaveBeenCalledWith(storyReactions.storyId);
      expect(result.get("s1")).toBe(3);
    });
  });
});
