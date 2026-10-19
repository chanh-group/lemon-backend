import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { ConversationPgRepository } from "../../../../src/domain/conversation/pg.js";
import {
  conversationParticipants,
  conversations,
} from "../../../../src/domain/conversation/schema.js";
import { users } from "../../../../src/domain/user/schema.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

function makeSelectChain() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>();
  const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return { selectMock, fromMock, whereMock, limitMock };
}

function makeDb() {
  const txSelect = makeSelectChain();
  const dbSelect = makeSelectChain();

  const returningMock = vi.fn<(cols?: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const onConflictDoNothingMock = vi.fn<() => Promise<unknown>>().mockResolvedValue([]);
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
  }));
  const insertMock = vi.fn<(table: unknown) => unknown>(() => ({ values: valuesMock }));

  const tx = { select: txSelect.selectMock, insert: insertMock };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    select: dbSelect.selectMock,
    transaction: transactionMock,
  } as unknown as DrizzleDb;

  return {
    db,
    txSelect,
    dbSelect,
    insertMock,
    valuesMock,
    returningMock,
    onConflictDoNothingMock,
    transactionMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);

const userAId = "0193a2b1-0000-7000-8000-000000000001";
const userBId = "0193a2b1-0000-7000-8000-000000000002";
const directKey = `${userAId}:${userBId}`;

const convRow = {
  id: "0193a2b1-0000-7000-8000-000000000020",
  kind: "DIRECT" as const,
  directKey,
  lastMessagePreview: null,
  lastMessageAt: null,
  createdAt: new Date("2026-10-19T00:00:00Z"),
};

const newConvRow = {
  id: "0193a2b1-0000-7000-8000-000000000030",
  kind: "DIRECT" as const,
  directKey,
  title: null,
  avatarUrl: null,
  lastMessageId: null,
  lastMessageAt: null,
  lastMessagePreview: null,
  deletedAt: null,
  createdAt: new Date("2026-10-19T01:00:00Z"),
  updatedAt: new Date("2026-10-19T01:00:00Z"),
};

const partnerRow = {
  id: userBId,
  username: "bob",
  fullName: "Bob Nguyen",
  avatarUrl: null,
};

const uniqueViolation = { code: "23505", constraint: "conversations_direct_key_uq" };

describe("ConversationPgRepository.createDirectConversation", () => {
  it("returns the existing conversation when a concurrent insert hits the unique index", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    transactionMock.mockRejectedValueOnce(uniqueViolation);
    dbSelect.limitMock.mockResolvedValueOnce([convRow]).mockResolvedValueOnce([partnerRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createDirectConversation(userAId, userBId);

    expect(result).toEqual({ ...convRow, partner: partnerRow });
    expect(dbSelect.fromMock).toHaveBeenNthCalledWith(1, conversations);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."direct_key" =');
    expect(lookup.sql).toContain('"conversations"."deleted_at" is null');
    expect(lookup.params).toEqual([directKey]);
    expect(dbSelect.fromMock).toHaveBeenNthCalledWith(2, users);
    const partnerLookup = render(dbSelect.whereMock.mock.calls[1][0]);
    expect(partnerLookup.sql).toContain('"users"."id" =');
    expect(partnerLookup.params).toEqual([userBId]);
  });

  it("rejects with CONFLICT when the winning insert cannot be read back", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    transactionMock.mockRejectedValueOnce(uniqueViolation);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    const error = await repo
      .createDirectConversation(userAId, userBId)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe("CONFLICT");
    expect(dbSelect.limitMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-unique-violation error unchanged", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    const infraError = { code: "23503", constraint: "conversations_direct_key_uq" };
    transactionMock.mockRejectedValueOnce(infraError);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createDirectConversation(userAId, userBId)).rejects.toBe(infraError);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("rethrows a 23505 from a different constraint unchanged", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    const otherViolation = { code: "23505", constraint: "messages_client_msg_uq" };
    transactionMock.mockRejectedValueOnce(otherViolation);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createDirectConversation(userAId, userBId)).rejects.toBe(otherViolation);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("creates the conversation, participants and returns the partner on the happy path", async () => {
    const {
      db,
      txSelect,
      dbSelect,
      insertMock,
      valuesMock,
      returningMock,
      onConflictDoNothingMock,
    } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([partnerRow]);
    returningMock.mockResolvedValueOnce([newConvRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createDirectConversation(userAId, userBId);

    expect(result).toEqual({
      id: newConvRow.id,
      kind: "DIRECT",
      directKey,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: newConvRow.createdAt,
      partner: partnerRow,
    });
    expect(dbSelect.selectMock).not.toHaveBeenCalled();

    const preCheck = render(txSelect.whereMock.mock.calls[0][0]);
    expect(preCheck.sql).toContain('"conversations"."direct_key" =');
    expect(preCheck.params).toEqual([directKey]);
    const partnerLookup = render(txSelect.whereMock.mock.calls[1][0]);
    expect(partnerLookup.sql).toContain('"users"."id" =');
    expect(partnerLookup.params).toEqual([userBId]);
    expect(txSelect.fromMock).toHaveBeenNthCalledWith(1, conversations);
    expect(txSelect.fromMock).toHaveBeenNthCalledWith(2, users);

    expect(insertMock).toHaveBeenNthCalledWith(1, conversations);
    expect(valuesMock).toHaveBeenNthCalledWith(1, { kind: "DIRECT", directKey });
    expect(insertMock).toHaveBeenNthCalledWith(2, conversationParticipants);
    expect(valuesMock).toHaveBeenNthCalledWith(2, [
      { conversationId: newConvRow.id, userId: userAId, role: "MEMBER" },
      { conversationId: newConvRow.id, userId: userBId, role: "MEMBER" },
    ]);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
  });
});
