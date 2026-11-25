import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { StoryPgRepository } from "../../../../src/domain/story/pg.js";
import {
  STORY_FEED_MAX_PER_AUTHOR,
  STORY_VIEWER_WINDOW_HOURS,
} from "../../../../src/domain/story/constants.js";
import { STORY_TTL_MS } from "../../../../src/utils/cache/constants.js";
import { encodeReactionCursor } from "../../../../src/domain/story/dto/mapper.js";
import {
  stories,
  storyAudiences,
  storyReactions,
  storyViews,
  userStorySettings,
} from "../../../../src/domain/story/schema.js";
import { friendships } from "../../../../src/domain/friend/schema.js";
import { messages } from "../../../../src/domain/message/schema.js";
import { users } from "../../../../src/domain/user/schema.js";

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
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({
    onConflictDoUpdate: onConflictMock,
    onConflictDoNothing: onConflictDoNothingMock,
    returning: returningMock,
  }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));
  const deleteWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ returning: returningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
  const updateWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ returning: returningMock }));
  const updateSetMock = vi.fn<(set: Record<string, unknown>) => unknown>(() => ({
    where: updateWhereMock,
  }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const executeMock = vi.fn(() => Promise.resolve());
  const tx = { select: selectMock, insert: insertMock, update: updateMock, execute: executeMock };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    select: selectMock,
    delete: deleteMock,
    insert: insertMock,
    update: updateMock,
    execute: executeMock,
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
    updateMock,
    updateSetMock,
    updateWhereMock,
    insertMock,
    valuesMock,
    onConflictMock,
    onConflictDoNothingMock,
    returningMock,
    executeMock,
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

    it("isAcceptedFriend returns false when the canonical pair has no accepted row", async () => {
      const { db, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);

      await expect(repo.isAcceptedFriend("a-user", "z-user")).resolves.toBe(false);
      expect(limitMock).toHaveBeenCalledWith(1);
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

    it("addReactionWithView updates anonymous on an existing view", async () => {
      const { db, insertMock, valuesMock, onConflictMock, returningMock } = makeDb();
      returningMock.mockResolvedValue([
        {
          storyId: "s1",
          userId: "u1",
          emoji: "🔥",
          kind: "REACTION",
          createdAt: new Date(),
          updatedAt: new Date(),
          isNew: true,
        },
      ]);
      const repo = new StoryPgRepository(db);

      await repo.addReactionWithView("s1", "u1", "🔥", "REACTION", true);

      expect(insertMock).toHaveBeenCalledWith(storyViews);
      expect(valuesMock).toHaveBeenCalledWith({
        storyId: "s1",
        userId: "u1",
        anonymous: true,
      });
      const viewConflict = onConflictMock.mock.calls[0][0] as {
        target: unknown[];
        set: Record<string, unknown>;
      };
      expect(viewConflict.target).toEqual([storyViews.storyId, storyViews.userId]);
      expect(viewConflict.set.anonymous).toBe(true);
      expect(render(viewConflict.set.viewedAt as SQL)).toBe("now()");
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

      const conflict = onConflictMock.mock.calls[1][0] as {
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

    it("deleteReaction scopes the delete to one reaction kind when requested", async () => {
      const { db, deleteWhereMock, returningMock } = makeDb();
      returningMock.mockResolvedValue([{ storyId: "s1" }]);
      const repo = new StoryPgRepository(db);

      const result = await repo.deleteReaction("s1", "u1", "LIKE");

      expect(result).toBe(true);
      const whereSql = render(deleteWhereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"story_reactions"."kind" = $3');
      expect(dialect.sqlToQuery(deleteWhereMock.mock.calls[0][0]).params).toEqual([
        "s1",
        "u1",
        "LIKE",
      ]);
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

    it("findReactionsByStoryId filters by reaction kind when requested", async () => {
      const { db, whereMock, limitMock } = makeDb();
      limitMock.mockResolvedValue([]);
      const repo = new StoryPgRepository(db);

      await repo.findReactionsByStoryId("s1", undefined, 20, "LIKE");

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"story_reactions"."kind" = $2');
      expect(dialect.sqlToQuery(whereMock.mock.calls[0][0]).params).toEqual(["s1", "LIKE"]);
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

  it("does not filter stories based on legacy mutes", async () => {
    const { db, whereMock } = makeDb([]);
    await new StoryPgRepository(db).findActiveByUserIds(["u1"], "viewer-1");
    const feedWhere = whereMock.mock.calls
      .map(([condition]) => render(condition))
      .find((where) => where.includes('"stories"."expires_at" > now()'));
    expect(feedWhere).not.toContain("story_mutes");
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

  it("resolves CUSTOM inclusion and EXCLUDE removal through dedicated audience lookups", async () => {
    const { db, selectMock, fromMock, whereMock } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await repo.findActiveByUserIds(["u1"], "viewer-1");

    // Both membership checks project story_id from story_audiences for the viewer
    expect(selectMock).toHaveBeenCalledWith({ storyId: storyAudiences.storyId });
    expect(
      selectMock.mock.calls.filter(
        (call) => (call[0] as { storyId?: unknown } | undefined)?.storyId !== undefined,
      ),
    ).toHaveLength(2);
    expect(fromMock).toHaveBeenCalledWith(storyAudiences);

    const rendered = whereMock.mock.calls.map(([condition]) => render(condition));
    const feedWhere = rendered.find((where) => where.includes('"stories"."expires_at" > now()'));
    // CUSTOM stories are included only via in (...) membership, EXCLUDE ones via not in (...)
    expect(feedWhere).toContain('"stories"."audience_mode" = $4');
    expect(feedWhere).toContain('"stories"."id" in');
    expect(feedWhere).toContain('"stories"."audience_mode" = $6');
    expect(feedWhere).toContain('"stories"."id" not in');

    const lookupParams = whereMock.mock.calls
      .map(([condition]) => dialect.sqlToQuery(condition).params)
      .filter((params) => params.length === 1 && params[0] === "viewer-1");
    expect(lookupParams).toHaveLength(2);
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
    expect(countWhere).toContain("now() - $3 * interval '1 hour'");
    expect(dialect.sqlToQuery(whereMock.mock.calls[1][0]).params).toContain(
      STORY_VIEWER_WINDOW_HOURS,
    );
  });

  it("reports zero totalViewsCount when nobody has viewed the story yet", async () => {
    const { db, limitMock } = makeDb([]);
    limitMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    const page = await repo.findViewersByStoryId("s1", undefined, 20);

    expect(page.totalViewsCount).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
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

describe("StoryPgRepository.create", () => {
  const baseMediaStory = {
    userId: "user-1",
    kind: "IMAGE" as const,
    bucket: "b",
    objectKey: "stories/user-1/a.jpg",
    mimeType: "image/jpeg",
    mediaSizeBytes: 1024,
    width: null,
    height: null,
    durationMs: null,
    caption: null,
    background: null,
    allowReplies: true,
    allowReactions: true,
    audienceMode: "ALL_FRIENDS" as const,
  };

  it("acquires an advisory lock and checks quota for media stories", async () => {
    const { db, executeMock, selectMock, returningMock } = makeDb([{ bytes: 0, unknown: 0 }]);
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    await repo.create(baseMediaStory);

    expect(executeMock).toHaveBeenCalledOnce();
    const lockSql = (executeMock.mock.calls[0] as unknown[])[0] as SQL;
    expect(render(lockSql)).toContain("pg_advisory_xact_lock");
    expect(selectMock).toHaveBeenCalled();
  });

  it("skips quota check and advisory lock for text stories", async () => {
    const { db, executeMock, returningMock } = makeDb([{ bytes: 0, unknown: 0 }]);
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    await repo.create({
      ...baseMediaStory,
      kind: "TEXT",
      objectKey: null,
      mimeType: null,
      mediaSizeBytes: null,
      caption: "hi",
    });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it("throws STORY_STORAGE_FULL when media exceeds quota", async () => {
    const { db, returningMock } = makeDb([{ bytes: 512 * 1024 * 1024 - 1, unknown: 0 }]);
    returningMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.create(baseMediaStory)).rejects.toMatchObject({ code: "STORY_STORAGE_FULL" });
  });

  it("throws STORY_STORAGE_UNAVAILABLE when unmeasured media exists", async () => {
    const { db, returningMock } = makeDb([{ bytes: 0, unknown: 1 }]);
    returningMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.create(baseMediaStory)).rejects.toMatchObject({
      code: "STORY_STORAGE_UNAVAILABLE",
    });
  });

  it("sets expires_at from the story TTL constant", async () => {
    const { db, valuesMock, returningMock } = makeDb([{ bytes: 0, unknown: 0 }]);
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    await repo.create(baseMediaStory);

    const storyValues = valuesMock.mock.calls[0][0] as { expiresAt: SQL };
    const query = dialect.sqlToQuery(storyValues.expiresAt);
    expect(query.sql).toBe("now() + $1 * interval '1 millisecond'");
    expect(query.params).toEqual([STORY_TTL_MS]);
  });

  it("inserts CUSTOM audience rows in the same transaction as the story", async () => {
    const { db, insertMock, valuesMock, returningMock, transactionMock } = makeDb([
      { bytes: 0, unknown: 0 },
    ]);
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    const result = await repo.create({ ...baseMediaStory, audienceMode: "CUSTOM" }, [
      "friend-a",
      "friend-b",
    ]);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: "s1" });
    expect(insertMock).toHaveBeenNthCalledWith(1, stories);
    expect(insertMock).toHaveBeenNthCalledWith(2, storyAudiences);
    expect(valuesMock).toHaveBeenNthCalledWith(2, [
      { storyId: "s1", userId: "friend-a" },
      { storyId: "s1", userId: "friend-b" },
    ]);
  });

  it("writes no audience rows for ALL_FRIENDS stories even when audience ids are passed", async () => {
    const { db, insertMock, returningMock } = makeDb([{ bytes: 0, unknown: 0 }]);
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    await repo.create(baseMediaStory, ["friend-a"]);

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalledWith(storyAudiences);
  });
});

describe("StoryPgRepository.findById", () => {
  it("returns the story when it is not deleted", async () => {
    const storyRow = { id: "s1", userId: "u1", deletedAt: null };
    const { db, whereMock } = makeDb([storyRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findById("s1");

    expect(result).toEqual(storyRow);
    const whereSql = render(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"stories"."id" = $1');
    expect(whereSql).toContain('"stories"."deleted_at" is null');
    expect(dialect.sqlToQuery(whereMock.mock.calls[0][0]).params).toEqual(["s1"]);
  });

  it("returns null when the story is missing or deleted", async () => {
    const { db } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.findById("gone")).resolves.toBeNull();
  });
});

describe("StoryPgRepository.updateActive", () => {
  const updateData = { caption: "updated", allowReplies: false };

  it("only updates an owned, unexpired, undeleted, unarchived story", async () => {
    const storyRow = { id: "s1", userId: "u1", caption: "updated" };
    const { db, updateMock, updateSetMock, updateWhereMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([storyRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.updateActive("s1", "u1", updateData);

    expect(result).toEqual(storyRow);
    expect(updateMock).toHaveBeenCalledWith(stories);
    expect(updateSetMock).toHaveBeenCalledWith(updateData);
    const whereSql = render(updateWhereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"stories"."id" = $1');
    expect(whereSql).toContain('"stories"."user_id" = $2');
    expect(whereSql).toContain('"stories"."expires_at" > now()');
    expect(whereSql).toContain('"stories"."deleted_at" is null');
    expect(whereSql).toContain('"stories"."archived_at" is null');
    expect(dialect.sqlToQuery(updateWhereMock.mock.calls[0][0]).params).toEqual(["s1", "u1"]);
  });

  it("returns null when no active story matches", async () => {
    const { db, returningMock } = makeDb();
    returningMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.updateActive("s1", "u2", updateData)).resolves.toBeNull();
  });
});

describe("StoryPgRepository.findViewableByIds", () => {
  it("keeps only active stories: unexpired, undeleted and unarchived", async () => {
    const rows = [
      { id: "s1", userId: "u1" },
      { id: "s2", userId: "u2" },
    ];
    const { db, whereMock } = makeDb(rows);
    const repo = new StoryPgRepository(db);

    await expect(repo.findViewableByIds(["s1", "s2"], "u1")).resolves.toEqual(rows);

    const whereSql = render(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"stories"."id" in');
    expect(whereSql).toContain('"stories"."expires_at" > now()');
    expect(whereSql).toContain('"stories"."deleted_at" is null');
    expect(whereSql).toContain('"stories"."archived_at" is null');
    expect(whereSql).not.toContain('"stories"."user_id"');
    expect(dialect.sqlToQuery(whereMock.mock.calls[0][0]).params).toEqual(["s1", "s2"]);
  });

  it("queries nothing when the id list or the viewer is empty", async () => {
    const { db, whereMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await expect(repo.findViewableByIds([], "u1")).resolves.toEqual([]);
    await expect(repo.findViewableByIds(["s1"], "")).resolves.toEqual([]);
    expect(whereMock).not.toHaveBeenCalled();
  });
});

describe("StoryPgRepository.findActiveById", () => {
  it("returns the story only while it is unexpired, undeleted and unarchived", async () => {
    const storyRow = { id: "s1", userId: "u1" };
    const { db, whereMock } = makeDb([storyRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findActiveById("s1");

    expect(result).toEqual(storyRow);
    const whereSql = render(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"stories"."id" = $1');
    expect(whereSql).toContain('"stories"."expires_at" > now()');
    expect(whereSql).toContain('"stories"."deleted_at" is null');
    expect(whereSql).toContain('"stories"."archived_at" is null');
    expect(dialect.sqlToQuery(whereMock.mock.calls[0][0]).params).toEqual(["s1"]);
  });

  it("returns null when the story is gone", async () => {
    const { db } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.findActiveById("gone")).resolves.toBeNull();
  });
});

describe("StoryPgRepository.setMediaSizes", () => {
  it("backfills all measured rows in one update while sizes are still unknown", async () => {
    const { db, executeMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await repo.setMediaSizes([
      { id: "s1", sizeBytes: 2048 },
      { id: "s2", sizeBytes: 500 },
    ]);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const query = dialect.sqlToQuery((executeMock.mock.calls as unknown as Array<[SQL]>)[0][0]);
    expect(query.sql).toContain("UPDATE stories");
    expect(query.sql).toContain("media_size_bytes = measured.size_bytes");
    expect(query.sql).toContain("stories.media_size_bytes IS NULL");
    expect(query.params).toEqual(["s1", 2048, "s2", 500]);
  });

  it("does not touch the database for an empty batch", async () => {
    const { db, executeMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await repo.setMediaSizes([]);

    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("StoryPgRepository.findUsersByIds", () => {
  it("returns an empty map when no ids are requested", async () => {
    const { db, selectMock } = makeDb();
    const repo = new StoryPgRepository(db);

    const result = await repo.findUsersByIds([]);
    expect(result.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("maps user summaries by id", async () => {
    const { db, selectMock, whereMock } = makeDb([
      { id: "u1", username: "f1", fullName: "F1", avatarUrl: null },
      { id: "u2", username: "f2", fullName: "F2", avatarUrl: "a.png" },
    ]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findUsersByIds(["u1", "u2"]);

    expect(selectMock).toHaveBeenCalledWith({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
    });
    expect(result.get("u1")).toEqual({ id: "u1", username: "f1", fullName: "F1", avatarUrl: null });
    expect(result.get("u2")?.avatarUrl).toBe("a.png");
    expect(result.size).toBe(2);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"users"."id" in (');
    expect(query.params).toEqual(["u1", "u2"]);
  });
});

describe("StoryPgRepository.findViewedStoryIds", () => {
  it("returns an empty set for an empty story list", async () => {
    const { db, selectMock } = makeDb();
    const repo = new StoryPgRepository(db);

    const result = await repo.findViewedStoryIds("u1", []);
    expect(result.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns only the story ids the user has viewed", async () => {
    const { db, whereMock } = makeDb([{ storyId: "s1" }, { storyId: "s3" }]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findViewedStoryIds("u1", ["s1", "s2", "s3"]);

    expect(result).toEqual(new Set(["s1", "s3"]));
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"story_views"."user_id" = $1');
    expect(query.sql).toContain('"story_views"."story_id" in (');
    expect(query.params).toEqual(["u1", "s1", "s2", "s3"]);
  });
});

describe("StoryPgRepository.markAsViewed", () => {
  it("records a non-anonymous view with an upsert keyed on story and user", async () => {
    const { db, insertMock, valuesMock, onConflictMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await repo.markAsViewed("s1", "u1");

    expect(insertMock).toHaveBeenCalledWith(storyViews);
    expect(valuesMock).toHaveBeenCalledWith({ storyId: "s1", userId: "u1", anonymous: false });
    const conflict = onConflictMock.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflict.target).toEqual([storyViews.storyId, storyViews.userId]);
    expect(conflict.set.anonymous).toBe(false);
    expect(render(conflict.set.viewedAt as SQL)).toBe("now()");
  });

  it("keeps the anonymous flag on the recorded view", async () => {
    const { db, valuesMock, onConflictMock } = makeDb();
    const repo = new StoryPgRepository(db);

    await repo.markAsViewed("s1", "u1", true);

    expect(valuesMock).toHaveBeenCalledWith({ storyId: "s1", userId: "u1", anonymous: true });
    const conflict = onConflictMock.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(conflict.set.anonymous).toBe(true);
  });
});

describe("StoryPgRepository.markDeleted", () => {
  it("soft deletes a live story and reports success", async () => {
    const { db, updateMock, updateSetMock, updateWhereMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const repo = new StoryPgRepository(db);

    const result = await repo.markDeleted("s1");

    expect(result).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(stories);
    const set = updateSetMock.mock.calls[0][0] as { deletedAt: SQL };
    expect(render(set.deletedAt)).toBe("now()");
    const whereSql = render(updateWhereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"stories"."id" = $1');
    expect(whereSql).toContain('"stories"."deleted_at" is null');
    expect(dialect.sqlToQuery(updateWhereMock.mock.calls[0][0]).params).toEqual(["s1"]);
  });

  it("returns false when the story was already deleted", async () => {
    const { db, returningMock } = makeDb();
    returningMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.markDeleted("s1")).resolves.toBe(false);
  });
});

describe("StoryPgRepository.getFriendUserIds", () => {
  it("returns the counterpart of the pair for either column ordering", async () => {
    const { db, whereMock } = makeDb([
      { userLow: "u1", userHigh: "u2" },
      { userLow: "u3", userHigh: "u1" },
    ]);
    const repo = new StoryPgRepository(db);

    const result = await repo.getFriendUserIds("u1");

    expect(result).toEqual(["u2", "u3"]);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"friendships"."status" = $1');
    expect(query.sql).toContain('"friendships"."user_low" = $2');
    expect(query.sql).toContain('"friendships"."user_high" = $3');
    expect(query.params).toEqual(["ACCEPTED", "u1", "u1"]);
  });

  it("returns an empty list when the user has no friendships", async () => {
    const { db } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.getFriendUserIds("u1")).resolves.toEqual([]);
  });
});

describe("StoryPgRepository.archiveStories", () => {
  it("performs no transaction for an empty id list", async () => {
    const { db, transactionMock, updateMock } = makeDb();
    const repo = new StoryPgRepository(db);

    const result = await repo.archiveStories([]);

    expect(result).toBe(0);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("detaches message snapshots and stamps archived_at in one transaction", async () => {
    const { db, updateMock, updateSetMock, updateWhereMock, returningMock, transactionMock } =
      makeDb();
    returningMock.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    const repo = new StoryPgRepository(db);

    const result = await repo.archiveStories(["s1", "s2"]);

    expect(result).toBe(2);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(1, messages);
    expect(updateMock).toHaveBeenNthCalledWith(2, stories);
    expect(updateSetMock).toHaveBeenNthCalledWith(1, { storyId: null });
    const storySet = updateSetMock.mock.calls[1][0] as { archivedAt: SQL };
    expect(render(storySet.archivedAt)).toBe("now()");

    const messageWhere = render(updateWhereMock.mock.calls[0][0]);
    expect(messageWhere).toContain('"messages"."story_id" in (');
    const storyWhere = render(updateWhereMock.mock.calls[1][0]);
    expect(storyWhere).toContain('"stories"."id" in (');
    expect(dialect.sqlToQuery(updateWhereMock.mock.calls[1][0]).params).toEqual(["s1", "s2"]);
  });
});

describe("StoryPgRepository.summarizeReactions", () => {
  it("groups reactions by emoji without a kind filter", async () => {
    const { db, whereMock, groupByMock } = makeDb();
    groupByMock.mockResolvedValue([
      { emoji: "🔥", count: 2 },
      { emoji: "❤️", count: 1 },
    ]);
    const repo = new StoryPgRepository(db);

    const result = await repo.summarizeReactions("s1");

    expect(groupByMock).toHaveBeenCalledWith(storyReactions.emoji);
    expect(result).toEqual([
      { emoji: "🔥", count: 2 },
      { emoji: "❤️", count: 1 },
    ]);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"story_reactions"."story_id" = $1');
    expect(query.params).toEqual(["s1"]);
  });

  it("narrows the summary to one reaction kind when requested", async () => {
    const { db, whereMock, groupByMock } = makeDb();
    groupByMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    const result = await repo.summarizeReactions("s1", "LIKE");

    expect(result).toEqual([]);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"story_reactions"."kind" = $2');
    expect(query.params).toEqual(["s1", "LIKE"]);
  });
});

describe("StoryPgRepository settings", () => {
  it("getUserStorySettings returns the stored row when it exists", async () => {
    const settingsRow = {
      userId: "u1",
      viewedReceiptsEnabled: false,
      archiveEnabled: false,
      archiveDurationSecs: 604800,
    };
    const { db, whereMock } = makeDb([settingsRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.getUserStorySettings("u1");

    expect(result).toEqual(settingsRow);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"user_story_settings"."user_id" = $1');
    expect(query.params).toEqual(["u1"]);
  });

  it("getUserStorySettings falls back to defaults when nothing is stored", async () => {
    const { db } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.getUserStorySettings("u1")).resolves.toEqual({
      userId: "u1",
      viewedReceiptsEnabled: true,
      archiveEnabled: true,
      archiveDurationSecs: null,
    });
  });

  it("upsertUserStorySettings writes only the provided fields on conflict", async () => {
    const settingsRow = {
      userId: "u1",
      viewedReceiptsEnabled: false,
      archiveEnabled: false,
      archiveDurationSecs: 604800,
    };
    const { db, valuesMock, onConflictMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([settingsRow]);
    const repo = new StoryPgRepository(db);

    const result = await repo.upsertUserStorySettings("u1", {
      viewedReceiptsEnabled: false,
      archiveEnabled: false,
      archiveDurationSecs: 604800,
    });

    expect(result).toEqual(settingsRow);
    expect(valuesMock).toHaveBeenCalledWith(settingsRow);
    const conflict = onConflictMock.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflict.target).toEqual([userStorySettings.userId]);
    expect(conflict.set).toMatchObject({
      viewedReceiptsEnabled: false,
      archiveEnabled: false,
      archiveDurationSecs: 604800,
    });
    expect(render(conflict.set.updatedAt as SQL)).toBe("now()");
  });

  it("upsertUserStorySettings touches only updatedAt when no field is provided", async () => {
    const { db, valuesMock, onConflictMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([
      {
        userId: "u1",
        viewedReceiptsEnabled: true,
        archiveEnabled: true,
        archiveDurationSecs: null,
      },
    ]);
    const repo = new StoryPgRepository(db);

    await repo.upsertUserStorySettings("u1", {});

    expect(valuesMock).toHaveBeenCalledWith({
      userId: "u1",
      viewedReceiptsEnabled: true,
      archiveEnabled: true,
      archiveDurationSecs: null,
    });
    const conflict = onConflictMock.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(Object.keys(conflict.set)).toEqual(["updatedAt"]);
  });
});

describe("StoryPgRepository audience lookups", () => {
  it("findStoryAudienceUserIds returns the allowed user ids", async () => {
    const { db, whereMock } = makeDb([{ userId: "a1" }, { userId: "a2" }]);
    const repo = new StoryPgRepository(db);

    const result = await repo.findStoryAudienceUserIds("s1");

    expect(result).toEqual(["a1", "a2"]);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"story_audiences"."story_id" = $1');
    expect(query.params).toEqual(["s1"]);
  });

  it("findStoryAudienceUserIds returns an empty list for a story without audience rows", async () => {
    const { db } = makeDb([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.findStoryAudienceUserIds("s1")).resolves.toEqual([]);
  });

  it("isStoryAudience confirms membership with a bounded lookup", async () => {
    const { db, selectMock, whereMock, limitMock } = makeDb();
    limitMock.mockResolvedValue([{ userId: "u1" }]);
    const repo = new StoryPgRepository(db);

    await expect(repo.isStoryAudience("s1", "u1")).resolves.toBe(true);
    expect(selectMock).toHaveBeenCalledWith({ userId: storyAudiences.userId });
    expect(limitMock).toHaveBeenCalledWith(1);
    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"story_audiences"."story_id" = $1');
    expect(query.sql).toContain('"story_audiences"."user_id" = $2');
    expect(query.params).toEqual(["s1", "u1"]);
  });

  it("isStoryAudience returns false when the user is not on the audience list", async () => {
    const { db, limitMock } = makeDb();
    limitMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    await expect(repo.isStoryAudience("s1", "u2")).resolves.toBe(false);
  });
});

describe("StoryPgRepository.findArchivedStoriesByUserId", () => {
  const archivedRow = (id: string, createdAt: string) => ({
    id,
    userId: "u1",
    kind: "TEXT",
    bucket: null,
    objectKey: null,
    mimeType: null,
    width: null,
    height: null,
    durationMs: null,
    caption: "memory",
    background: null,
    allowReplies: true,
    allowReactions: true,
    audienceMode: "ALL_FRIENDS",
    archivedAt: new Date("2026-11-05T00:00:00Z"),
    createdAt: new Date(createdAt),
    expiresAt: new Date("2026-11-02T00:00:00Z"),
    deletedAt: null,
  });
  const toItem = (row: ReturnType<typeof archivedRow>) => {
    const { deletedAt: _deletedAt, ...item } = row;
    return item;
  };

  it("lists archived stories mapped to story items on the first page", async () => {
    const { db, whereMock, orderByMock, limitMock } = makeDb();
    limitMock.mockResolvedValue([archivedRow("s1", "2026-11-01T00:00:00Z")]);
    const repo = new StoryPgRepository(db);

    const page = await repo.findArchivedStoriesByUserId("u1", undefined, 20);

    expect(limitMock).toHaveBeenCalledWith(21);
    expect(page.items).toEqual([toItem(archivedRow("s1", "2026-11-01T00:00:00Z"))]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();

    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"stories"."user_id" = $1');
    expect(query.sql).toContain('"stories"."archived_at" is not null');
    expect(query.sql).toContain('"stories"."deleted_at" is null');
    expect(query.params).toEqual(["u1"]);
    const orderByCalls = orderByMock.mock.calls[0] as unknown as [SQL, SQL];
    expect(render(orderByCalls[0])).toContain('"stories"."created_at" desc');
    expect(render(orderByCalls[1])).toContain('"stories"."id" desc');
  });

  it("pages past the limit with a story id cursor", async () => {
    const { db, whereMock, limitMock } = makeDb();
    limitMock.mockResolvedValue([
      archivedRow("s2", "2026-11-03T00:00:00Z"),
      archivedRow("s1", "2026-11-01T00:00:00Z"),
    ]);
    const repo = new StoryPgRepository(db);

    const page = await repo.findArchivedStoriesByUserId("u1", "s9", 1);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(toItem(archivedRow("s2", "2026-11-03T00:00:00Z")));
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("s2");

    const query = dialect.sqlToQuery(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"stories"."created_at" <');
    expect(query.sql).toContain('"stories"."created_at" =');
    expect(query.sql).toContain('"stories"."id" <');
    expect(query.sql).toContain("SELECT s.created_at FROM stories s WHERE s.id =");
    expect(query.params).toEqual(["u1", "s9", "u1", "s9", "u1", "s9"]);
  });

  it("returns an empty page when the user has no archived stories", async () => {
    const { db, limitMock } = makeDb();
    limitMock.mockResolvedValue([]);
    const repo = new StoryPgRepository(db);

    const page = await repo.findArchivedStoriesByUserId("u1", undefined, 20);

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });
});
