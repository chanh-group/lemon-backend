import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { conversations } from "../../../../src/domain/conversation/schema.js";
import { MessagePgRepository } from "../../../../src/domain/message/pg.js";
import { ATTACHMENT_PREVIEW_TOKEN } from "../../../../src/domain/message/constants.js";
import { type Message, messages } from "../../../../src/domain/message/schema.js";
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

  const returningMock = vi.fn<(cols?: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({ returning: returningMock }));
  const insertMock = vi.fn<(table: unknown) => unknown>(() => ({ values: valuesMock }));

  const updateWhereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const setMock = vi.fn<(values: unknown) => unknown>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<(table: unknown) => unknown>(() => ({ set: setMock }));

  const dbSelect = makeSelectChain();

  const tx = { select: txSelect.selectMock, insert: insertMock, update: updateMock };
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
    updateMock,
    setMock,
    updateWhereMock,
    transactionMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);

const conversationId = "0193a2b1-0000-7000-8000-000000000010";
const senderId = "0193a2b1-0000-7000-8000-000000000001";
const clientMsgId = "0193a2b1-0000-7000-8000-0000000000c1";

const existingRow: Message = {
  id: "0193a2b1-0000-7000-8000-000000000020",
  conversationId,
  senderId,
  kind: "TEXT",
  body: "Hello from the first attempt",
  replyToId: null,
  clientMsgId,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-10-19T00:00:00Z"),
};

const messageId = existingRow.id;

const uniqueViolation = { code: "23505", constraint: "messages_client_msg_uq" };

describe("MessagePgRepository.createMessageWithConversationUpdate", () => {
  it("returns the existing row when a concurrent insert hits the unique index", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    transactionMock.mockRejectedValueOnce(uniqueViolation);
    dbSelect.limitMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      clientMsgId,
    });

    expect(result).toEqual({ message: existingRow, isNew: false });
    expect(dbSelect.fromMock).toHaveBeenCalledWith(messages);
    expect(dbSelect.limitMock).toHaveBeenCalledWith(1);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"messages"."conversation_id" =');
    expect(lookup.sql).toContain('"messages"."sender_id" =');
    expect(lookup.sql).toContain('"messages"."client_msg_id" =');
    expect(lookup.params).toEqual([conversationId, senderId, clientMsgId]);
  });

  it("rejects with CONFLICT when the winning insert cannot be read back", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    transactionMock.mockRejectedValueOnce(uniqueViolation);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    const error = await repo
      .createMessageWithConversationUpdate({
        conversationId,
        senderId,
        body: "Hello from the first attempt",
        clientMsgId,
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe("CONFLICT");
    expect(dbSelect.limitMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-unique-violation error unchanged", async () => {
    const { db, transactionMock } = makeDb();
    const infraError = { code: "23503", constraint: "messages_client_msg_uq" };
    transactionMock.mockRejectedValueOnce(infraError);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({
        conversationId,
        senderId,
        body: "Hello from the first attempt",
        clientMsgId,
      }),
    ).rejects.toBe(infraError);
  });

  it("rethrows a 23505 from a different constraint unchanged", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    const otherViolation = { code: "23505", constraint: "conversations_direct_key_uq" };
    transactionMock.mockRejectedValueOnce(otherViolation);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({
        conversationId,
        senderId,
        body: "Hello from the first attempt",
        clientMsgId,
      }),
    ).rejects.toBe(otherViolation);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("inserts the message and refreshes the conversation preview on the happy path", async () => {
    const { db, txSelect, dbSelect, returningMock, updateMock, setMock, updateWhereMock } =
      makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    returningMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      clientMsgId,
    });

    expect(result).toEqual({ message: existingRow, isNew: true });
    expect(txSelect.selectMock).toHaveBeenCalledTimes(1);
    const preCheck = render(txSelect.whereMock.mock.calls[0][0]);
    expect(preCheck.sql).toContain('"messages"."client_msg_id" =');
    expect(preCheck.params).toEqual([conversationId, senderId, clientMsgId]);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(conversations);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMessageId: existingRow.id,
        lastMessageAt: existingRow.createdAt,
        lastMessagePreview: "Hello from the first attempt",
        updatedAt: expect.any(Date),
      }),
    );
    const update = render(updateWhereMock.mock.calls[0][0]);
    expect(update.sql).toContain('"conversations"."id" =');
    expect(update.params).toEqual([conversationId]);
  });

  it("uses the attachment preview when the message has no body", async () => {
    const { db, txSelect, returningMock, setMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const attachmentRow: Message = { ...existingRow, body: null, kind: "IMAGE" };
    returningMock.mockResolvedValueOnce([attachmentRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      kind: "IMAGE",
      clientMsgId,
    });

    expect(result).toEqual({ message: attachmentRow, isNew: true });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastMessagePreview: ATTACHMENT_PREVIEW_TOKEN }),
    );
  });
});

describe("MessagePgRepository.resolveWriteMiss", () => {
  it("scopes the read to id, conversation and sender without filtering revoked rows", async () => {
    const { db, dbSelect } = makeDb();
    const revokedRow: Message = {
      ...existingRow,
      body: null,
      deletedAt: new Date("2026-10-19T01:00:00Z"),
    };
    dbSelect.limitMock.mockResolvedValueOnce([revokedRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.resolveWriteMiss(messageId, senderId, conversationId);

    expect(result).toEqual(revokedRow);
    expect(dbSelect.fromMock).toHaveBeenCalledWith(messages);
    expect(dbSelect.limitMock).toHaveBeenCalledWith(1);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"messages"."id" =');
    expect(lookup.sql).toContain('"messages"."conversation_id" =');
    expect(lookup.sql).toContain('"messages"."sender_id" =');
    expect(lookup.sql).not.toContain("deleted_at");
    expect(lookup.params).toEqual([messageId, conversationId, senderId]);
  });

  it("returns null when no row matches the write scope", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    const result = await repo.resolveWriteMiss(messageId, senderId, conversationId);

    expect(result).toBeNull();
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.params).toEqual([messageId, conversationId, senderId]);
  });
});
