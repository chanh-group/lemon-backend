import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { NotePgRepository } from "../../../../src/domain/note/pg.js";
import { notes, type Note } from "../../../../src/domain/note/schema.js";

describe("NotePgRepository.upsert", () => {
  const userId = "0193a2b1-0000-7000-8000-0000000000aa";
  const expiresAt = new Date("2026-10-18T00:00:00Z");
  const noteRow: Note = {
    id: "0193a2b1-0000-7000-8000-0000000000bb",
    userId,
    content: "Sunny day note",
    background: "#ffcc00",
    createdAt: new Date("2026-10-17T00:00:00Z"),
    expiresAt,
  };

  function makeDb() {
    const returningMock = vi.fn().mockResolvedValue([noteRow]);
    const onConflictDoUpdateMock = vi.fn(() => ({ returning: returningMock }));
    const valuesMock = vi.fn(() => ({
      onConflictDoUpdate: onConflictDoUpdateMock,
      returning: returningMock,
    }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const deleteMock = vi.fn();
    const tx = { insert: insertMock, delete: deleteMock };
    const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const db = {
      insert: insertMock,
      delete: deleteMock,
      transaction: transactionMock,
    } as unknown as DrizzleDb;
    return { db, insertMock, deleteMock, onConflictDoUpdateMock };
  }

  it("upsert writes a single insert with onConflictDoUpdate targeting user_id", async () => {
    const { db, insertMock, onConflictDoUpdateMock } = makeDb();
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

  it("upsert refreshes createdAt alongside content and expiresAt", async () => {
    const { db, onConflictDoUpdateMock } = makeDb();
    const repo = new NotePgRepository(db);

    await repo.upsert(userId, { content: "Sunny day note", background: "#ffcc00", expiresAt });

    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          content: "Sunny day note",
          background: "#ffcc00",
          expiresAt,
          createdAt: expect.any(Date),
        }),
      }),
    );
  });
});
