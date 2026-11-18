import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { StoryPgRepository } from "../../../../src/domain/story/pg.js";
import { STORY_FEED_MAX_PER_AUTHOR } from "../../../../src/domain/story/constants.js";
import { encodeReactionCursor } from "../../../../src/domain/story/dto/mapper.js";
import {
  stories,
  storyMutes,
  storyReactions,
  storyViews,
  userStorySettings,
} from "../../../../src/domain/story/schema.js";
import { friendships } from "../../../../src/domain/friend/schema.js";

function makeDb(rows: unknown[] = []) {
  const limitMock = vi.fn<(limit: number) => Promise<unknown>>();
  const groupByMock = vi.fn<(column: unknown) => Promise<unknown>>();
  const asMock = vi.fn<(alias: string) => unknown>((alias) => ({ subqueryAlias: alias }));
  const orderByMock = vi.fn<(condition: SQL) => unknown>(() =>
    Object.assign(Promise.resolve(rows), { limit: limitMock }),
  );
  const whereMock = vi.fn<(condition: SQL) => unknown>(() =>
    Object.assign(Promise.resolve(rows), {
      orderBy: orderByMock,
      limit: limitMock,
      groupBy: groupByMock,
      as: asMock,
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
  const selectMock = vi.fn((_selection?: unknown) => ({ from: fromMock }));
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
    fromMock,
    whereMock,
    orderByMock,
    groupByMock,
    asMock,
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
      const rows = [
        {
          id: "s1",
          objectKey: "k1",
          userId: "u1",
          archivedAt: null,
          deletedAt: null,
          archiveEnabled: true,
        },
      ];
      limitMock.mockResolvedValue(rows);
      const repo = new StoryPgRepository(db);

      const result = await repo.findPurgeable(500);

      expect(selectMock).toHaveBeenCalledWith({
        id: stories.id,
        objectKey: stories.objectKey,
        userId: stories.userId,
        archivedAt: stories.archivedAt,
        deletedAt: stories.deletedAt,
        archiveEnabled: userStorySettings.archiveEnabled,
      });
      expect(limitMock).toHaveBeenCalledWith(500);
      expect(result).toEqual(rows);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"stories"."expires_at" < now()');
      expect(whereSql).toContain('"stories"."deleted_at" is not null or');
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

    it("findReactionsByStoryId pages with a valid legacy UUID cursor", async () => {
      const { db, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);
      const legacyCursor = "00000000-0000-4000-8000-000000000001";

      await repo.findReactionsByStoryId("s1", legacyCursor, 20);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain("SELECT sr.created_at FROM story_reactions sr");
      expect(whereSql).toContain('"story_reactions"."created_at" <');
      expect(whereSql).toContain('"users"."id" <');
    });

    it("findReactionsByStoryId pages with an encoded cursor without subquery", async () => {
      const { db, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);
      const encoded = encodeReactionCursor(
        new Date("2026-10-24T18:00:00.000Z"),
        "00000000-0000-4000-8000-000000000001",
      );

      await repo.findReactionsByStoryId("s1", encoded, 20);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).not.toContain("SELECT sr.created_at FROM story_reactions sr");
      expect(whereSql).toContain('"story_reactions"."created_at" <');
      expect(whereSql).toContain('"users"."id" <');
    });

    it("findReactionsByStoryId throws BAD_REQUEST when cursor is neither valid encoded cursor nor legacy UUID", async () => {
      const { db } = makeDb();
      const repo = new StoryPgRepository(db);

      await expect(repo.findReactionsByStoryId("s1", "not-a-valid-cursor", 20)).rejects.toThrow(
        BusinessError,
      );
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

describe("StoryPgRepository.findActiveByUserIds", () => {
  const storyRow = {
    id: "s1",
    userId: "u1",
    kind: "TEXT",
    bucket: null,
    objectKey: null,
    mimeType: null,
    width: null,
    height: null,
    durationMs: null,
    caption: "hello",
    background: null,
    allowReplies: true,
    allowReactions: true,
    audienceMode: "ALL_FRIENDS",
    archivedAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    expiresAt: new Date("2026-11-02T00:00:00Z"),
    deletedAt: null,
    feedRank: 1,
  };

  it("does not query for an empty user list", async () => {
    const { db, selectMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await expect(repo.findActiveByUserIds([])).resolves.toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("caps each author to their most recent stories with a row_number window", async () => {
    const { db, selectMock, whereMock, orderByMock } = makeDb([storyRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findActiveByUserIds(["u1"]);

    const fields = selectMock.mock.calls[0][0] as { feedRank: { getSQL(): SQL } };
    const windowSql = render(fields.feedRank.getSQL());
    expect(windowSql).toContain("row_number() over (partition by");
    expect(windowSql).toContain(
      'partition by "stories"."user_id" order by "stories"."created_at" desc',
    );

    const capWhere = whereMock.mock.calls[1][0];
    expect(render(capWhere)).toContain("feed_rank <=");
    expect(dialect.sqlToQuery(capWhere).params).toEqual([STORY_FEED_MAX_PER_AUTHOR]);
    expect(render(orderByMock.mock.calls[0][0])).toContain("created_at");

    const { feedRank: _feedRank, ...expectedStory } = storyRow;
    expect(result).toEqual([expectedStory]);
    expect(result[0]).not.toHaveProperty("feedRank");
  });

  it("excludes muted authors with a NOT EXISTS in the same query instead of a second round trip", async () => {
    const { db, fromMock, whereMock } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await repo.findActiveByUserIds(["u1"], "viewer-1");

    const feedWhere = whereMock.mock.calls
      .map(([condition]) => render(condition))
      .find((where) => where.includes('"stories"."expires_at" > now()'));
    expect(feedWhere).toContain('not exists (select 1 from "story_mutes"');
    expect(feedWhere).toContain('"story_mutes"."author_id" = "stories"."user_id"');
    expect(fromMock).not.toHaveBeenCalledWith(storyMutes);
  });

  it("keeps the audience visibility rules for the viewer", async () => {
    const { db, whereMock } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await repo.findActiveByUserIds(["u1"], "viewer-1");

    const rendered = whereMock.mock.calls.map(([condition]) => render(condition));
    const feedWhere = rendered.find((where) => where.includes('"stories"."expires_at" > now()'));
    expect(feedWhere).toContain('"stories"."user_id" =');
    expect(feedWhere).toContain('"stories"."audience_mode" =');
    expect(feedWhere).toContain('"stories"."id" in');
    expect(feedWhere).toContain('"stories"."id" not in');

    // CUSTOM/EXCLUDE membership lookups still resolve the viewer's audience rows
    const audienceLookups = rendered.filter((where) =>
      where.includes('"story_audiences"."user_id" ='),
    );
    expect(audienceLookups).toHaveLength(2);
    for (const lookup of audienceLookups) {
      expect(lookup).toContain('"story_audiences"."user_id" = $1');
    }
  });
});

describe("StoryPgRepository.findViewersByStoryId", () => {
  const viewerRow = {
    userId: "u1",
    username: "f1",
    fullName: "F1",
    avatarUrl: null,
    viewedAt: new Date("2026-11-01T00:00:00Z"),
    reaction: null,
    reactionKind: null,
  };

  it("reports the same totalViewsCount on a cursor page as on the first page", async () => {
    const { db, limitMock } = makeDb([{ total: 7 }]);
    limitMock.mockResolvedValue([viewerRow]);
    const repo = new StoryPgRepository(db);

    const first = await repo.findViewersByStoryId("s1", undefined, 20);
    const second = await repo.findViewersByStoryId("s1", "u0", 20);

    expect(first.totalViewsCount).toBe(7);
    expect(second.totalViewsCount).toBe(7);
    expect(second.items).toHaveLength(1);
  });

  it("keeps the cursor predicate out of the count query while rows still page from it", async () => {
    const { db, whereMock, limitMock } = makeDb([{ total: 7 }]);
    limitMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await repo.findViewersByStoryId("s1", "u0", 20);

    const rowWhere = render(whereMock.mock.calls[0][0]);
    const countWhere = render(whereMock.mock.calls[1][0]);
    expect(rowWhere).toContain("SELECT sv.viewed_at FROM story_views sv");
    expect(countWhere).not.toContain("SELECT sv.viewed_at FROM story_views sv");
    expect(countWhere).toContain('"story_views"."story_id" = $1');
    expect(countWhere).toContain('"story_views"."anonymous" = $2');
    expect(countWhere).toContain("now() - interval '24 hours'");
  });
});

describe("story storage accounting", () => {
  it("excludes deleted stories when calculating available space", async () => {
    const { db, whereMock } = makeDb([{ bytes: 123 }]);
    expect(await new StoryPgRepository(db).getStorageUsage("user-1")).toBe(123);
    expect(render(whereMock.mock.calls[0][0])).toContain('"stories"."deleted_at" is null');
  });

  it("only backfills media still counted against quota", async () => {
    const { db, whereMock } = makeDb([{ id: "s", objectKey: "stories/u/a.jpg" }]);
    expect(await new StoryPgRepository(db).findUnmeasuredMedia("user-1")).toHaveLength(1);
    const query = render(whereMock.mock.calls[0][0]);
    expect(query).toContain('"stories"."deleted_at" is null');
    expect(query).toContain('"stories"."media_size_bytes" is null');
  });
});
