import type { SQL } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { conversations } from "../../../../src/domain/conversation/schema.js";
import { MessagePgRepository } from "../../../../src/domain/message/pg.js";
import {
  ATTACHMENT_PREVIEW_TOKEN,
  STORY_REACTION_PREVIEW_TOKEN,
} from "../../../../src/domain/message/constants.js";
import { type Message, messages, messageReactions } from "../../../../src/domain/message/schema.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

function makeSelectChain() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>().mockResolvedValue([]);
  const forMock = vi.fn(() => ({ limit: limitMock }));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereObj = {
    limit: limitMock,
    for: forMock,
    orderBy: orderByMock,
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      limitMock(0).then(resolve, reject),
  };
  const whereMock = vi.fn<(condition: SQL) => typeof whereObj>(() => whereObj);
  const innerJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({ where: whereMock, innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return { selectMock, fromMock, whereMock, innerJoinMock, forMock, orderByMock, limitMock };
}

function makeDb() {
  const txSelect = makeSelectChain();

  const returningMock = vi.fn<(cols?: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const dbOnConflictMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({
    returning: returningMock,
    onConflictDoUpdate: dbOnConflictMock,
  }));
  const insertMock = vi.fn<(table: unknown) => unknown>(() => ({ values: valuesMock }));

  const updateWhereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const setMock = vi.fn<(values: unknown) => unknown>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<(table: unknown) => unknown>(() => ({ set: setMock }));

  const dbSelect = makeSelectChain();

  const deleteWhereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const deleteMock = vi.fn<(table: unknown) => unknown>(() => ({ where: deleteWhereMock }));

  const dbValuesMock = vi.fn(() => ({
    onConflictDoUpdate: dbOnConflictMock,
    returning: returningMock,
  }));
  const dbInsertMock = vi.fn(() => ({ values: dbValuesMock }));

  const tx = {
    select: txSelect.selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    select: dbSelect.selectMock,
    transaction: transactionMock,
    delete: deleteMock,
    insert: dbInsertMock,
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
    deleteMock,
    deleteWhereMock,
    dbInsertMock,
    dbValuesMock,
    dbOnConflictMock,
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
  storyId: null,
  storyPreview: null,
  clientMsgId,
  isForwarded: false,
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
    const infraError = { code: "08006", message: "connection failure" };
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

  it("maps a foreign-key violation to BAD_REQUEST instead of an opaque 500", async () => {
    const { db, transactionMock } = makeDb();
    const fkViolation = { code: "23503", constraint: "messages_story_id_stories_id_fk" };
    transactionMock.mockRejectedValueOnce(fkViolation);
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
    expect((error as BusinessError).code).toBe("BAD_REQUEST");
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
    const values = setMock.mock.calls[0][0] as { unreadRevision: SQL; lastMessagePreview: SQL };
    expect(render(values.unreadRevision).sql).toContain('"conversations"."unread_revision" + 1');
    expect(render(values.lastMessagePreview).params).toContain("Hello from the first attempt");
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
    const values = setMock.mock.calls[0][0] as { lastMessagePreview: SQL };
    expect(render(values.lastMessagePreview).params).toContain(ATTACHMENT_PREVIEW_TOKEN);
  });

  it("uses the story reaction marker as the conversation preview", async () => {
    const { db, txSelect, returningMock, setMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const reactionRow: Message = { ...existingRow, body: "🔥", kind: "STORY_REACTION" };
    returningMock.mockResolvedValueOnce([reactionRow]);
    const repo = new MessagePgRepository(db);

    await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "🔥",
      kind: "STORY_REACTION",
      clientMsgId,
    });

    const values = setMock.mock.calls[0][0] as { lastMessagePreview: SQL };
    expect(render(values.lastMessagePreview).params).toContain(STORY_REACTION_PREVIEW_TOKEN);
  });

  it("locks the accepted friendship until a direct message transaction commits", async () => {
    const { db, txSelect, returningMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ status: "ACCEPTED" }]).mockResolvedValueOnce([]);
    returningMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      requiredFriendship: { userAId: senderId, userBId: "0193a2b1-0000-7000-8000-000000000002" },
    });

    expect(txSelect.forMock).toHaveBeenCalledWith("share");
    const lookup = render(txSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"friendships"."user_low" =');
    expect(lookup.sql).toContain('"friendships"."user_high" =');
    expect(lookup.params).toEqual([senderId, "0193a2b1-0000-7000-8000-000000000002"]);
  });

  it("rejects a direct message if the friendship was blocked before the transaction lock", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ status: "BLOCKED" }]);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({
        conversationId,
        senderId,
        body: "Hello",
        requiredFriendship: { userAId: senderId, userBId: "0193a2b1-0000-7000-8000-000000000002" },
      }),
    ).rejects.toMatchObject({ code: "USER_BLOCKED" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts message with storyId and storyPreview", async () => {
    const { db, txSelect, valuesMock, returningMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const storyId = "0193a2b1-0000-7000-8000-000000000099";
    const storyPreview = {
      id: storyId,
      kind: "IMAGE" as const,
      bucket: "lemon-stories",
      objectKey: "stories/u/a.jpg",
      caption: "Sunset",
      background: null,
    };
    const storyReplyRow: Message = {
      ...existingRow,
      storyId,
      storyPreview,
    };
    returningMock.mockResolvedValueOnce([storyReplyRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Nice photo!",
      storyId,
      storyPreview,
    });

    expect(result).toEqual({ message: storyReplyRow, isNew: true });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId,
        storyPreview,
      }),
    );
  });
});

describe("MessagePgRepository.findTimeline", () => {
  it("orders and paginates by createdAt, using the UUID only as a tie-breaker", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await repo.findTimeline(conversationId, messageId);

    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain("m.created_at FROM messages m");
    expect(where.sql).toContain('"messages"."created_at" <');
    expect(dbSelect.orderByMock).toHaveBeenCalledWith(desc(messages.createdAt), desc(messages.id));
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

describe("MessagePgRepository.reactMessage", () => {
  it("throws MESSAGE_NOT_FOUND when message does not exist", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]); // find message
    const repo = new MessagePgRepository(db);

    await expect(repo.reactMessage(senderId, messageId, "❤️")).rejects.toThrow(
      new BusinessError("MESSAGE_NOT_FOUND"),
    );
  });

  it("throws MESSAGE_NOT_FOUND when message is revoked", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([
      { conversationId, deletedAt: new Date("2026-10-19T01:00:00Z") },
    ]);
    const repo = new MessagePgRepository(db);

    await expect(repo.reactMessage(senderId, messageId, "❤️")).rejects.toThrow(
      new BusinessError("MESSAGE_NOT_FOUND"),
    );
  });

  it("throws NOT_PARTICIPANT when user is not an active participant", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([]); // no participant
    const repo = new MessagePgRepository(db);

    await expect(repo.reactMessage(senderId, messageId, "❤️")).rejects.toThrow(
      new BusinessError("NOT_PARTICIPANT"),
    );
  });

  it("removes reaction when reacting with the same emoji (toggle off)", async () => {
    const { db, txSelect, deleteMock, deleteWhereMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([{ userId: senderId }]); // participant exists
    txSelect.limitMock.mockResolvedValueOnce([{ emoji: "❤️", userId: senderId }]); // existing reaction
    txSelect.limitMock.mockResolvedValueOnce([]); // allReactions after removal
    const repo = new MessagePgRepository(db);

    const result = await repo.reactMessage(senderId, messageId, "❤️");

    expect(deleteMock).toHaveBeenCalledWith(messageReactions);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(txSelect.forMock).toHaveBeenCalledWith("update");
    expect(result).toEqual({ reactions: [], conversationId });
  });

  it("upserts reaction when reacting with a new or different emoji", async () => {
    const { db, txSelect, insertMock, valuesMock, dbOnConflictMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([{ userId: senderId }]); // participant exists
    txSelect.limitMock.mockResolvedValueOnce([{ emoji: "👍", userId: senderId }]); // existing reaction differs
    txSelect.limitMock.mockResolvedValueOnce([
      { emoji: "❤️", userId: senderId },
      { emoji: "❤️", userId: "user-2" },
    ]); // allReactions query
    const repo = new MessagePgRepository(db);

    const result = await repo.reactMessage(senderId, messageId, "❤️");

    expect(insertMock).toHaveBeenCalledWith(messageReactions);
    expect(valuesMock).toHaveBeenCalledWith({
      messageId,
      userId: senderId,
      emoji: "❤️",
    });
    expect(dbOnConflictMock).toHaveBeenCalled();
    expect(result.conversationId).toBe(conversationId);
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0].emoji).toBe("❤️");
    expect(result.reactions[0].count).toBe(2);
  });

  it("rejects a direct reaction if the friendship is blocked under the transaction lock", async () => {
    const { db, txSelect, transactionMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ status: "BLOCKED" }]);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.reactMessage(senderId, messageId, "❤️", {
        userAId: senderId,
        userBId: "0193a2b1-0000-7000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "USER_BLOCKED" });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(txSelect.forMock).toHaveBeenCalledWith("share");
  });
});
