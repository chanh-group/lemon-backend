import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { NotePgRepository } from "../../../../src/domain/note/pg.js";
import { notes, type Note } from "../../../../src/domain/note/schema.js";

function makeDb() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown>>();
  const orderByMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
  const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const returningMock = vi.fn().mockResolvedValue([]);
  const deleteWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ returning: returningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const onConflictDoUpdateMock = vi.fn(() => ({ returning: returningMock }));
  const valuesMock = vi.fn(() => ({
    onConflictDoUpdate: onConflictDoUpdateMock,
    returning: returningMock,
  }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  const tx = { insert: insertMock, delete: deleteMock };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    insert: insertMock,
    delete: deleteMock,
    select: selectMock,
    transaction: transactionMock,
  } as unknown as DrizzleDb;

  return {
    db,
    selectMock,
    whereMock,
    orderByMock,
    limitMock,
    insertMock,
    deleteMock,
    deleteWhereMock,
    returningMock,
    onConflictDoUpdateMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL): string => dialect.sqlToQuery(condition).sql;

describe("NotePgRepository.upsert", () => {
  const userId = "0193a2b1-0000-7000-8000-0000000000aa";
  const expiresAt = new Date("2026-10-18T00:00:00Z");
  const noteRow: Note = {
    id: "0193a2b1-0000-7000-8000-0000000000bb",
    userId,
    content: "Sunny day note",
    background: "#ffcc00",
    createdAt: new Date("2026-10-17T00:00:00Z"),
    updatedAt: new Date("2026-10-17T00:00:00Z"),
    expiresAt,
  };

  it("upsert writes a single insert with onConflictDoUpdate targeting user_id", async () => {
    const { db, insertMock, onConflictDoUpdateMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([noteRow]);
    const repo = new NotePgRepository(db);

    const result = await repo.upsert(userId, {
      content: "Sunny day note",
      background: "#ffcc00",
      expiresAt,
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: notes.userId }),
    );
    expect(result).toEqual(noteRow);
  });

  it("upsert performs no delete", async () => {
    const { db, deleteMock } = makeDb();
    const repo = new NotePgRepository(db);

    await repo.upsert(userId, { content: "Sunny day note", expiresAt });

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("upsert preserves createdAt and refreshes updatedAt with the DB clock", async () => {
    const { db, onConflictDoUpdateMock } = makeDb();
    const repo = new NotePgRepository(db);

    await repo.upsert(userId, { content: "Sunny day note", background: "#ffcc00", expiresAt });

    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          content: "Sunny day note",
          background: "#ffcc00",
          expiresAt,
          updatedAt: expect.anything(),
        }),
      }),
    );
  });
});

describe("NotePgRepository.findActiveFeedByUserIds", () => {
  it("joins note profiles in the active notes query", async () => {
    const userId = "0193a2b1-0000-7000-8000-0000000000aa";
    const note = {
      id: "0193a2b1-0000-7000-8000-0000000000bb",
      userId,
      content: "Sunny day note",
      background: null,
      createdAt: new Date("2026-10-17T00:00:00Z"),
      updatedAt: new Date("2026-10-17T00:00:00Z"),
      expiresAt: new Date("2026-10-18T00:00:00Z"),
    };
    const row = {
      note,
      user: { id: userId, username: "user1", fullName: "User One", avatarUrl: null },
    };
    const orderByMock = vi
      .fn<(first: SQL, second: SQL) => Promise<(typeof row)[]>>()
      .mockResolvedValue([row]);
    const whereMock = vi.fn<(condition: SQL) => { orderBy: typeof orderByMock }>(() => ({
      orderBy: orderByMock,
    }));
    const innerJoinMock = vi.fn(() => ({ where: whereMock }));
    const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));
    const repo = new NotePgRepository({ select: selectMock } as unknown as DrizzleDb);

    await expect(repo.findActiveFeedByUserIds([userId])).resolves.toEqual([row]);
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        note: notes,
        user: expect.objectContaining({ id: expect.anything() }),
      }),
    );
    expect(innerJoinMock).toHaveBeenCalledTimes(1);
    expect(render(whereMock.mock.calls[0][0])).toContain('"notes"."expires_at" >');
    expect(orderByMock).toHaveBeenCalledWith(expect.anything(), expect.anything());
  });

  it("does not query for an empty user list", async () => {
    const { db, selectMock } = makeDb();
    const repo = new NotePgRepository(db);

    await expect(repo.findActiveFeedByUserIds([])).resolves.toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("NotePgRepository.findExpiredIds", () => {
  it("findExpiredIds selects ids with a DB-clock expiry predicate and batch limit", async () => {
    const { db, selectMock, whereMock, orderByMock, limitMock } = makeDb();
    const rows = [{ id: "n1" }, { id: "n2" }];
    limitMock.mockResolvedValue(rows);
    const repo = new NotePgRepository(db);

    const result = await repo.findExpiredIds(500);

    expect(selectMock).toHaveBeenCalledWith({ id: notes.id });
    expect(limitMock).toHaveBeenCalledWith(500);
    expect(result).toEqual(["n1", "n2"]);

    const whereSql = render(whereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"notes"."expires_at" < now()');

    const orderBySql = render(orderByMock.mock.calls[0][0]);
    expect(orderBySql).toContain('"notes"."expires_at" asc');
  });
});

describe("NotePgRepository.deleteByIds", () => {
  it("deleteByIds deletes exactly the given ids and returns the count", async () => {
    const { db, deleteMock, deleteWhereMock, returningMock } = makeDb();
    returningMock.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);
    const repo = new NotePgRepository(db);

    const result = await repo.deleteByIds(["n1", "n2"]);

    expect(result).toBe(2);
    expect(deleteMock).toHaveBeenCalledWith(notes);

    const whereSql = render(deleteWhereMock.mock.calls[0][0]);
    expect(whereSql).toContain('"notes"."id" in (');
  });

  it("deleteByIds with an empty list performs no query", async () => {
    const { db, deleteMock } = makeDb();
    const repo = new NotePgRepository(db);

    const result = await repo.deleteByIds([]);

    expect(result).toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
