import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { StoryPgRepository } from "../../../../src/domain/story/pg.js";
import { stories } from "../../../../src/domain/story/schema.js";

function makeDb() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown>>();
  const orderByMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
  const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const returningMock = vi.fn();
  const deleteWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ returning: returningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));
  const db = { select: selectMock, delete: deleteMock } as unknown as DrizzleDb;
  return {
    db,
    selectMock,
    whereMock,
    orderByMock,
    limitMock,
    deleteMock,
    deleteWhereMock,
    returningMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL): string => dialect.sqlToQuery(condition).sql;

describe("StoryPgRepository purge queries", () => {
  describe("findPurgeable", () => {
    it("findPurgeable selects id and object_key with the batch limit", async () => {
      const { db, selectMock, whereMock, orderByMock, limitMock } = makeDb();
      const rows = [{ id: "s1", objectKey: "k1" }];
      limitMock.mockResolvedValue(rows);
      const repo = new StoryPgRepository(db);

      const result = await repo.findPurgeable(500);

      expect(selectMock).toHaveBeenCalledWith({ id: stories.id, objectKey: stories.objectKey });
      expect(limitMock).toHaveBeenCalledWith(500);
      expect(result).toEqual(rows);

      const whereSql = render(whereMock.mock.calls[0][0]);
      expect(whereSql).toContain('"stories"."expires_at" < now()');
      expect(whereSql).toContain('"stories"."deleted_at" is not null');
      expect(whereSql).toContain(" or ");

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
});
