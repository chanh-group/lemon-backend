import type { SQL } from "drizzle-orm";
import { asc, desc, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { conversations, conversationParticipants } from "../../../../src/domain/conversation/schema.js";
import { MessagePgRepository } from "../../../../src/domain/message/pg.js";
import {
  ATTACHMENT_PREVIEW_TOKEN,
  MESSAGE_REVOKED_PREVIEW_TOKEN,
  STORY_REACTION_PREVIEW_TOKEN,
} from "../../../../src/domain/message/constants.js";
import type { ReplyTargetMessage } from "../../../../src/domain/message/repository.js";
import {
  type Message,
  type MessageAttachment,
  type MessageReaction,
  messageAttachments,
  messageHiddenForUsers,
  messageReactions,
  messages,
} from "../../../../src/domain/message/schema.js";
import { MAX_MESSAGE_PAGE_SIZE } from "../../../../src/domain/pagination.constants.js";
import { users } from "../../../../src/domain/user/schema.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

function makeSelectChain() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>().mockResolvedValue([]);
  const forMock = vi.fn(() => ({ limit: limitMock }));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const makeWhereResult = (condition: SQL) => ({
    limit: limitMock,
    for: forMock,
    orderBy: orderByMock,
    // Renders like the EXISTS probe the repository builds with notExists().
    getSQL: () => sql`select 1 where ${condition}`,
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      limitMock(0).then(resolve, reject),
  });
  const whereMock = vi.fn(makeWhereResult);
  const innerJoinMock = vi.fn(() => ({ where: whereMock }));
  const fromMock = vi.fn(() => ({ where: whereMock, innerJoin: innerJoinMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return { selectMock, fromMock, whereMock, innerJoinMock, forMock, orderByMock, limitMock };
}

function makeDb() {
  const txSelect = makeSelectChain();

  const returningMock = vi.fn<(cols?: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const dbOnConflictMock = vi.fn().mockResolvedValue([]);
  const onConflictDoNothingMock = vi
    .fn<(config: { target: unknown[]; where: SQL }) => { returning: typeof returningMock }>()
    .mockReturnValue({ returning: returningMock });
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
    onConflictDoUpdate: dbOnConflictMock,
  }));
  const insertMock = vi.fn<(table: unknown) => unknown>(() => ({ values: valuesMock }));

  const updateReturningMock = vi
    .fn<(cols?: unknown) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const updateWhereResult = {
    returning: updateReturningMock,
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  const updateWhereMock = vi.fn<(condition: SQL) => typeof updateWhereResult>(
    () => updateWhereResult,
  );
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
    onConflictDoNothingMock,
    returningMock,
    updateMock,
    setMock,
    updateWhereMock,
    updateReturningMock,
    deleteMock,
    deleteWhereMock,
    dbInsertMock,
    dbValuesMock,
    dbOnConflictMock,
    transactionMock,
  };
}

function mockActiveGroupMember(
  txSelect: ReturnType<typeof makeSelectChain>,
  withClientMsgId = true,
) {
  txSelect.limitMock
    .mockResolvedValueOnce([{ kind: "GROUP" }])
    .mockResolvedValueOnce([{ leftAt: null }]);
  if (withClientMsgId) txSelect.limitMock.mockResolvedValueOnce([]);
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
const partnerId = "0193a2b1-0000-7000-8000-000000000002";

const uniqueViolation = { code: "23505", constraint: "messages_client_msg_uq" };
const boundaryId = "0193a2b1-0000-7000-8000-000000000030";
const joinedAt = new Date("2026-01-01T00:00:00Z");

const attachmentRow: MessageAttachment = {
  id: "0193a2b1-0000-7000-8000-000000000040",
  messageId,
  kind: "IMAGE",
  bucket: "lemon-media",
  objectKey: "msg/u1/a.jpg",
  fileName: "a.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1234,
  width: 1200,
  height: 800,
  durationMs: null,
  checksum: "abc123",
  createdAt: new Date("2026-10-19T00:00:01Z"),
};

const reactionRow: MessageReaction = {
  messageId,
  userId: senderId,
  emoji: "❤️",
  createdAt: new Date("2026-10-19T00:00:02Z"),
};

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

    expect(result).toEqual({ message: { ...existingRow, attachments: [] }, isNew: false });
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
    const {
      db,
      txSelect,
      dbSelect,
      returningMock,
      updateMock,
      setMock,
      updateWhereMock,
      onConflictDoNothingMock,
    } = makeDb();
    mockActiveGroupMember(txSelect);
    returningMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      clientMsgId,
    });

    expect(result).toEqual({ message: existingRow, isNew: true });
    expect(txSelect.selectMock).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    const conflictTarget = onConflictDoNothingMock.mock.calls[0][0];
    expect(conflictTarget.target).toHaveLength(3);
    expect(render(conflictTarget.where).sql).toContain('"messages"."client_msg_id" IS NOT NULL');
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
    mockActiveGroupMember(txSelect);
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
    mockActiveGroupMember(txSelect);
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
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "DIRECT" }])
      .mockResolvedValueOnce([{ leftAt: null }])
      .mockResolvedValueOnce([{ status: "ACCEPTED" }]);
    returningMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      requiredFriendship: { userAId: senderId, userBId: "0193a2b1-0000-7000-8000-000000000002" },
    });

    expect(txSelect.forMock).toHaveBeenCalledWith("share");
    const lookup = render(txSelect.whereMock.mock.calls[2][0]);
    expect(lookup.sql).toContain('"friendships"."user_low" =');
    expect(lookup.sql).toContain('"friendships"."user_high" =');
    expect(lookup.params).toEqual([senderId, "0193a2b1-0000-7000-8000-000000000002"]);
  });

  it("rejects a direct message if the friendship was blocked before the transaction lock", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "DIRECT" }])
      .mockResolvedValueOnce([{ leftAt: null }])
      .mockResolvedValueOnce([{ status: "BLOCKED" }]);
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
    mockActiveGroupMember(txSelect);
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

  it("returns the existing row when the insert is swallowed by the clientMsgId unique index", async () => {
    const { db, txSelect, returningMock, onConflictDoNothingMock } = makeDb();
    returningMock.mockResolvedValueOnce([]);
    mockActiveGroupMember(txSelect, false);
    txSelect.limitMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      body: "Hello from the first attempt",
      clientMsgId,
    });

    expect(result).toEqual({ message: { ...existingRow, attachments: [] }, isNew: false });
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    const lookup = render(txSelect.whereMock.mock.calls[2][0]);
    expect(lookup.sql).toContain('"messages"."client_msg_id" =');
    expect(lookup.params).toEqual([conversationId, senderId, clientMsgId]);
  });

  it("rejects with CONFLICT when the swallowed insert has no readable row", async () => {
    const { db, txSelect, returningMock } = makeDb();
    returningMock.mockResolvedValueOnce([]);
    mockActiveGroupMember(txSelect, false);
    txSelect.limitMock.mockResolvedValueOnce([]);
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
    expect(txSelect.selectMock).toHaveBeenCalledTimes(3);
  });

  it("throws CONVERSATION_NOT_FOUND when the conversation is missing", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({ conversationId, senderId, body: "Hello" }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws NOT_PARTICIPANT when the sender has left the conversation", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "GROUP" }])
      .mockResolvedValueOnce([{ leftAt: new Date("2026-09-01T00:00:00Z") }]);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({ conversationId, senderId, body: "Hello" }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws FRIENDSHIP_REQUIRED when the direct relation is not accepted", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "DIRECT" }])
      .mockResolvedValueOnce([{ leftAt: null }])
      .mockResolvedValueOnce([{ status: "PENDING" }]);
    const repo = new MessagePgRepository(db);

    await expect(
      repo.createMessageWithConversationUpdate({
        conversationId,
        senderId,
        body: "Hello",
        requiredFriendship: { userAId: senderId, userBId: partnerId },
      }),
    ).rejects.toMatchObject({ code: "FRIENDSHIP_REQUIRED" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts the attachments and returns them on the new message", async () => {
    const { db, txSelect, insertMock, valuesMock, returningMock } = makeDb();
    mockActiveGroupMember(txSelect);
    const attachmentMessage: Message = { ...existingRow, kind: "IMAGE", body: null };
    returningMock.mockResolvedValueOnce([attachmentMessage]).mockResolvedValueOnce([attachmentRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.createMessageWithConversationUpdate({
      conversationId,
      senderId,
      kind: "IMAGE",
      clientMsgId,
      attachments: [
        {
          bucket: "lemon-media",
          objectKey: "msg/u1/a.jpg",
          fileName: "a.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1234,
          kind: "IMAGE",
          width: 1200,
        },
      ],
    });

    expect(result).toEqual({
      message: { ...attachmentMessage, attachments: [attachmentRow] },
      isNew: true,
    });
    expect(insertMock).toHaveBeenCalledWith(messageAttachments);
    expect(valuesMock.mock.calls[1][0]).toEqual([
      {
        messageId: attachmentMessage.id,
        kind: "IMAGE",
        bucket: "lemon-media",
        objectKey: "msg/u1/a.jpg",
        fileName: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1234,
        width: 1200,
        height: null,
        durationMs: null,
        checksum: null,
      },
    ]);
  });
});

describe("MessagePgRepository.findTimeline", () => {
  it("orders and paginates by createdAt, using the UUID only as a tie-breaker", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      { historyBoundaryMessageId: null, joinedAt: new Date(0) },
    ]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await repo.findTimeline(conversationId, senderId, messageId);

    const where = render(dbSelect.whereMock.mock.calls[2][0]);
    expect(where.sql).toContain("m.created_at FROM messages m");
    expect(where.sql).toContain('"messages"."created_at" <');
    expect(dbSelect.orderByMock).toHaveBeenCalledWith(desc(messages.createdAt), desc(messages.id));
  });

  it("returns an unauthorized empty page without querying when the viewer id is missing", async () => {
    const { db, dbSelect } = makeDb();
    const repo = new MessagePgRepository(db);

    await expect(repo.findTimeline(conversationId, "")).resolves.toEqual({
      items: [],
      hasMore: false,
      authorized: false,
    });
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("returns an unauthorized empty page when the viewer left the conversation", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.findTimeline(conversationId, senderId)).resolves.toEqual({
      items: [],
      hasMore: false,
      authorized: false,
    });
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(1);
    expect(dbSelect.fromMock).toHaveBeenCalledWith(conversationParticipants);
    const membership = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(membership.sql).toContain('"conversation_participants"."left_at" is null');
    expect(membership.params).toEqual([conversationId, senderId]);
  });

  it("walks forward from an after cursor in ascending order", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await repo.findTimeline(conversationId, senderId, undefined, 10, messageId);

    expect(dbSelect.orderByMock).toHaveBeenCalledWith(asc(messages.createdAt), asc(messages.id));
    expect(dbSelect.limitMock).toHaveBeenCalledWith(11);
    const where = render(dbSelect.whereMock.mock.calls[2][0]);
    expect(where.sql).toContain('"messages"."created_at" >');
    expect(where.sql).toContain("SELECT m.created_at FROM messages m");
    expect(where.params).toEqual([
      conversationId,
      senderId,
      conversationId,
      conversationId,
      messageId,
      conversationId,
      messageId,
      conversationId,
      messageId,
    ]);
  });

  it("bounds a window query by both the before and after cursors", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await repo.findTimeline(conversationId, senderId, messageId, 10, partnerId);

    const where = render(dbSelect.whereMock.mock.calls[2][0]);
    expect(where.sql).toContain('"messages"."created_at" <');
    expect(where.sql).toContain('"messages"."id" <');
    expect(where.sql).toContain('"messages"."id" >');
    expect(where.sql).toContain(
      '"conversation_participants"."history_boundary_message_id" IS NOT NULL',
    );
    expect(where.sql).toContain("history_boundary_was_empty");
    expect(where.sql).toContain('"message_hidden_for_users"."message_id"');
    expect(where.sql).toContain('"message_hidden_for_users"."user_id" =');
    expect(where.params).toEqual([
      conversationId,
      senderId,
      conversationId,
      conversationId,
      messageId,
      conversationId,
      messageId,
      conversationId,
      messageId,
      partnerId,
      conversationId,
      partnerId,
      conversationId,
      partnerId,
    ]);
  });

  it("returns an empty authorized page when no rows match the window", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.findTimeline(conversationId, senderId)).resolves.toEqual({
      items: [],
      nextCursor: undefined,
      hasMore: false,
      authorized: true,
    });
  });

  it("trims the over-fetched row and exposes the next cursor", async () => {
    const { db, dbSelect } = makeDb();
    const secondRow: Message = { ...existingRow, id: "0193a2b1-0000-7000-8000-000000000021" };
    const thirdRow: Message = { ...existingRow, id: "0193a2b1-0000-7000-8000-000000000022" };
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([
      { message: existingRow },
      { message: secondRow },
      { message: thirdRow },
    ]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findTimeline(conversationId, senderId, undefined, 2);

    expect(dbSelect.limitMock).toHaveBeenCalledWith(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(secondRow.id);
    expect(result.items).toEqual([
      { ...existingRow, attachments: [], reactions: [] },
      { ...secondRow, attachments: [], reactions: [] },
    ]);
    expect(result.authorized).toBe(true);
  });

  it("groups attachments and reactions per message and skips revoked rows in the detail lookups", async () => {
    const { db, dbSelect } = makeDb();
    const revokedRow: Message = {
      ...existingRow,
      id: "0193a2b1-0000-7000-8000-000000000023",
      deletedAt: new Date("2026-10-19T01:00:00Z"),
    };
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([{ message: revokedRow }, { message: existingRow }]);
    dbSelect.limitMock.mockResolvedValueOnce([attachmentRow]);
    dbSelect.limitMock.mockResolvedValueOnce([reactionRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findTimeline(conversationId, senderId);

    expect(result.items).toEqual([
      { ...revokedRow, attachments: [], reactions: [] },
      { ...existingRow, attachments: [attachmentRow], reactions: [reactionRow] },
    ]);
    const attachmentLookup = render(dbSelect.whereMock.mock.calls[3][0]);
    expect(attachmentLookup.sql).toContain('"message_attachments"."message_id" in');
    expect(attachmentLookup.params).toEqual([messageId]);
    const reactionLookup = render(dbSelect.whereMock.mock.calls[4][0]);
    expect(reactionLookup.sql).toContain('"message_reactions"."message_id" in');
    expect(reactionLookup.params).toEqual([messageId]);
  });

  it("keeps revoked messages in the page without running the detail lookups", async () => {
    const { db, dbSelect } = makeDb();
    const revokedRow: Message = { ...existingRow, deletedAt: new Date("2026-10-19T01:00:00Z") };
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([{ message: revokedRow }]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findTimeline(conversationId, senderId);

    expect(result).toEqual({
      items: [revokedRow],
      nextCursor: undefined,
      hasMore: false,
      authorized: true,
    });
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(3); // membership, hidden probe, timeline
  });

  it("clamps the page size into the configured bounds", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    dbSelect.limitMock.mockResolvedValueOnce([{ id: conversationId }]);
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await repo.findTimeline(conversationId, senderId, undefined, 0);
    await repo.findTimeline(conversationId, senderId, undefined, 999);

    expect(dbSelect.limitMock).toHaveBeenNthCalledWith(2, 2); // max(0, 1) + 1 over-fetch
    expect(dbSelect.limitMock).toHaveBeenNthCalledWith(4, MAX_MESSAGE_PAGE_SIZE + 1);
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
    dbSelect.limitMock.mockResolvedValueOnce([{ message: revokedRow }]);
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
    txSelect.limitMock.mockResolvedValueOnce([{ kind: "GROUP" }]); // conversation kind
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
    txSelect.limitMock.mockResolvedValueOnce([{ kind: "GROUP" }]); // conversation kind
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
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([{ userId: senderId }]); // participant exists
    txSelect.limitMock.mockResolvedValueOnce([{ kind: "DIRECT" }]); // conversation kind
    txSelect.limitMock.mockResolvedValueOnce([{ userId: partnerId }]); // direct partner
    txSelect.limitMock.mockResolvedValueOnce([{ status: "BLOCKED" }]); // friendship under share lock
    const repo = new MessagePgRepository(db);

    await expect(repo.reactMessage(senderId, messageId, "❤️")).rejects.toMatchObject({
      code: "USER_BLOCKED",
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(txSelect.forMock).toHaveBeenCalledWith("share");
  });

  it("allows a direct reaction when the friendship is accepted under the lock", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([{ userId: senderId }]); // participant exists
    txSelect.limitMock.mockResolvedValueOnce([{ kind: "DIRECT" }]); // conversation kind
    txSelect.limitMock.mockResolvedValueOnce([{ userId: partnerId }]); // direct partner
    txSelect.limitMock.mockResolvedValueOnce([{ status: "ACCEPTED" }]); // friendship under share lock
    txSelect.limitMock.mockResolvedValueOnce([]); // no existing reaction
    txSelect.limitMock.mockResolvedValueOnce([{ emoji: "❤️", userId: senderId }]); // allReactions
    const repo = new MessagePgRepository(db);

    const result = await repo.reactMessage(senderId, messageId, "❤️");

    expect(insertMock).toHaveBeenCalledWith(messageReactions);
    expect(result).toEqual({
      reactions: [{ emoji: "❤️", count: 1, userIds: [senderId] }],
      conversationId,
    });
  });

  it("skips the friendship gate when the direct partner has left the conversation", async () => {
    const { db, txSelect, insertMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([{ conversationId, deletedAt: null }]); // msg exists
    txSelect.limitMock.mockResolvedValueOnce([{ userId: senderId }]); // participant exists
    txSelect.limitMock.mockResolvedValueOnce([{ kind: "DIRECT" }]); // conversation kind
    txSelect.limitMock.mockResolvedValueOnce([]); // no active partner
    txSelect.limitMock.mockResolvedValueOnce([]); // no existing reaction
    txSelect.limitMock.mockResolvedValueOnce([]); // allReactions
    const repo = new MessagePgRepository(db);

    const result = await repo.reactMessage(senderId, messageId, "❤️");

    expect(insertMock).toHaveBeenCalledWith(messageReactions);
    expect(result).toEqual({ reactions: [], conversationId });
  });
});

describe("MessagePgRepository.findReplyTargets", () => {
  it("projects only the reply target fields consumed by responses", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      { historyBoundaryMessageId: null, joinedAt: new Date(0) },
    ]);
    const repo = new MessagePgRepository(db);

    await repo.findReplyTargets(conversationId, [messageId], senderId);

    expect(dbSelect.selectMock).toHaveBeenCalledWith({
      id: messages.id,
      senderId: messages.senderId,
      kind: messages.kind,
      body: messages.body,
      deletedAt: messages.deletedAt,
      storyPreview: messages.storyPreview,
    });
  });

  it("returns an empty list without querying when no ids are given", async () => {
    const { db, dbSelect } = makeDb();
    const repo = new MessagePgRepository(db);

    await expect(repo.findReplyTargets(conversationId, [], senderId)).resolves.toEqual([]);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("returns an empty list without querying when the viewer id is missing", async () => {
    const { db, dbSelect } = makeDb();
    const repo = new MessagePgRepository(db);

    await expect(repo.findReplyTargets(conversationId, [messageId], "")).resolves.toEqual([]);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("excludes hidden messages and enforces the history boundary for reply targets", async () => {
    const { db, dbSelect } = makeDb();
    const target: ReplyTargetMessage = {
      id: messageId,
      senderId,
      kind: "TEXT",
      body: "Hello from the first attempt",
      deletedAt: null,
      storyPreview: null,
    };
    dbSelect.limitMock.mockResolvedValueOnce([target]);
    const repo = new MessagePgRepository(db);

    await expect(repo.findReplyTargets(conversationId, [messageId], senderId)).resolves.toEqual([
      target,
    ]);

    const where = render(dbSelect.whereMock.mock.calls[1][0]);
    expect(where.sql).toContain('"messages"."id" in');
    expect(where.sql).toContain('"message_hidden_for_users"."user_id" =');
    expect(where.sql).toContain(
      '"conversation_participants"."history_boundary_message_id" IS NOT NULL',
    );
    expect(where.params).toEqual([
      conversationId,
      messageId,
      senderId,
      conversationId,
      conversationId,
    ]);
  });
});

describe("MessagePgRepository.findSenderProfiles", () => {
  it("returns no profiles without querying when the sender id list is empty", async () => {
    const { db, dbSelect } = makeDb();
    const repo = new MessagePgRepository(db);

    await expect(repo.findSenderProfiles([])).resolves.toEqual([]);
    expect(dbSelect.selectMock).not.toHaveBeenCalled();
  });

  it("selects profile fields for the deduplicated sender ids", async () => {
    const { db, dbSelect } = makeDb();
    const profile = { id: senderId, username: "alice", fullName: "Alice", avatarUrl: null };
    dbSelect.limitMock.mockResolvedValueOnce([profile]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findSenderProfiles([senderId, partnerId, senderId]);

    expect(result).toEqual([profile]);
    expect(dbSelect.selectMock).toHaveBeenCalledWith({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
    });
    expect(dbSelect.fromMock).toHaveBeenCalledWith(users);
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"users"."id" in');
    expect(where.params).toEqual([senderId, partnerId]);
  });
});

describe("MessagePgRepository.hideForUser", () => {
  it("throws MESSAGE_NOT_FOUND when the message does not exist", async () => {
    const { db, txSelect, returningMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.hideForUser(messageId, senderId)).rejects.toMatchObject({
      code: "MESSAGE_NOT_FOUND",
    });
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("throws MESSAGE_NOT_FOUND when the conversation has been deleted", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([]); // soft-deleted conversation
    const repo = new MessagePgRepository(db);

    await expect(repo.hideForUser(messageId, senderId)).rejects.toMatchObject({
      code: "MESSAGE_NOT_FOUND",
    });
  });

  it("throws MESSAGE_NOT_FOUND when the viewer is not an active participant", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([]); // no active membership
    const repo = new MessagePgRepository(db);

    await expect(repo.hideForUser(messageId, senderId)).rejects.toMatchObject({
      code: "MESSAGE_NOT_FOUND",
    });
  });

  it("throws MESSAGE_NOT_FOUND when the message predates the viewer's history window", async () => {
    const { db, txSelect } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([{ historyBoundaryMessageId: boundaryId, joinedAt }])
      .mockResolvedValueOnce([]); // outside the boundary window
    const repo = new MessagePgRepository(db);

    await expect(repo.hideForUser(messageId, senderId)).rejects.toMatchObject({
      code: "MESSAGE_NOT_FOUND",
    });
    const eligible = render(txSelect.whereMock.mock.calls[3][0]);
    expect(eligible.sql).toContain("ROW(");
    expect(eligible.sql).toContain("SELECT boundary.created_at, boundary.id FROM messages boundary");
    expect(eligible.params).toEqual([messageId, conversationId, boundaryId, conversationId]);
  });

  it("hides the message and bumps the unread revision on the first hide", async () => {
    const {
      db,
      txSelect,
      insertMock,
      valuesMock,
      returningMock,
      updateMock,
      setMock,
      updateWhereMock,
    } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([{ historyBoundaryMessageId: null, joinedAt }])
      .mockResolvedValueOnce([{ id: messageId }]);
    returningMock.mockResolvedValueOnce([{ messageId }]);
    const repo = new MessagePgRepository(db);

    const result = await repo.hideForUser(messageId, senderId);

    expect(result).toEqual({ conversationId, inserted: true });
    expect(insertMock).toHaveBeenCalledWith(messageHiddenForUsers);
    expect(valuesMock).toHaveBeenCalledWith({ messageId, userId: senderId });
    expect(updateMock).toHaveBeenCalledWith(conversations);
    const values = setMock.mock.calls[0][0] as { unreadRevision: SQL };
    expect(render(values.unreadRevision).sql).toContain('"conversations"."unread_revision" + 1');
    expect(render(updateWhereMock.mock.calls[0][0]).params).toEqual([conversationId]);
    const eligible = render(txSelect.whereMock.mock.calls[3][0]);
    expect(eligible.sql).toContain('"messages"."created_at" >');
    expect(eligible.sql).not.toContain("ROW(");
    expect(eligible.params).toEqual([messageId, conversationId, joinedAt.toISOString()]);
  });

  it("is idempotent and skips the unread bump when the message is already hidden", async () => {
    const { db, txSelect, returningMock, updateMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([{ historyBoundaryMessageId: null, joinedAt }])
      .mockResolvedValueOnce([{ id: messageId }]);
    returningMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    const result = await repo.hideForUser(messageId, senderId);

    expect(result).toEqual({ conversationId, inserted: false });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("MessagePgRepository.findById", () => {
  it("returns null when the message does not exist", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.findById(messageId)).resolves.toBeNull();
    expect(dbSelect.limitMock).toHaveBeenCalledWith(1);
  });

  it("returns the bare message without detail queries when includeDetails is false", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([existingRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findById(messageId, false);

    expect(result).toEqual(existingRow);
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the message's attachments and reactions when includeDetails is true", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock
      .mockResolvedValueOnce([existingRow])
      .mockResolvedValueOnce([attachmentRow])
      .mockResolvedValueOnce([reactionRow]);
    const repo = new MessagePgRepository(db);

    const result = await repo.findById(messageId);

    expect(result).toEqual({
      ...existingRow,
      attachments: [attachmentRow],
      reactions: [reactionRow],
    });
    const attachmentLookup = render(dbSelect.whereMock.mock.calls[1][0]);
    expect(attachmentLookup.sql).toContain('"message_attachments"."message_id" =');
    expect(attachmentLookup.params).toEqual([messageId]);
    const reactionLookup = render(dbSelect.whereMock.mock.calls[2][0]);
    expect(reactionLookup.sql).toContain('"message_reactions"."message_id" =');
    expect(reactionLookup.params).toEqual([messageId]);
  });
});

describe("MessagePgRepository.updateBody", () => {
  it("returns null when the message does not exist", async () => {
    const { db, txSelect, updateMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.updateBody(messageId, senderId, "Edited")).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns null when the sender is not an active participant", async () => {
    const { db, txSelect, updateMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([]) // conversation row lock
      .mockResolvedValueOnce([]); // no active membership
    const repo = new MessagePgRepository(db);

    await expect(repo.updateBody(messageId, senderId, "Edited")).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
    const participant = render(txSelect.whereMock.mock.calls[2][0]);
    expect(participant.sql).toContain('"conversation_participants"."left_at" is null');
    expect(participant.params).toEqual([conversationId, senderId]);
  });

  it("returns null when the message is already revoked", async () => {
    const { db, txSelect, updateMock, updateWhereMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: senderId }]);
    const repo = new MessagePgRepository(db);

    await expect(repo.updateBody(messageId, senderId, "Edited")).resolves.toBeNull();
    expect(updateMock).toHaveBeenCalledWith(messages);
    const scoped = render(updateWhereMock.mock.calls[0][0]);
    expect(scoped.sql).toContain('"messages"."deleted_at" is null');
    expect(scoped.params).toEqual([messageId, senderId]);
  });

  it("edits the body and refreshes the preview of the conversation's last message", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock, updateReturningMock } = makeDb();
    const body = "x".repeat(100);
    const edited: Message = {
      ...existingRow,
      body,
      editedAt: new Date("2026-10-19T02:00:00Z"),
    };
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: senderId }]);
    updateReturningMock.mockResolvedValueOnce([edited]);
    const repo = new MessagePgRepository(db);

    const result = await repo.updateBody(messageId, senderId, body);

    expect(result).toEqual(edited);
    expect(updateMock).toHaveBeenNthCalledWith(1, messages);
    expect(updateMock).toHaveBeenNthCalledWith(2, conversations);
    const messageValues = setMock.mock.calls[0][0] as { body: string; editedAt: SQL };
    expect(messageValues.body).toBe(body);
    expect(render(messageValues.editedAt).sql).toBe("now()");
    const conversationValues = setMock.mock.calls[1][0] as { lastMessagePreview: string };
    expect(conversationValues.lastMessagePreview).toBe("x".repeat(80));
    expect(render(updateWhereMock.mock.calls[1][0]).params).toEqual([conversationId, messageId]);
  });
});

describe("MessagePgRepository.softDelete", () => {
  it("returns null when the message does not exist", async () => {
    const { db, txSelect, updateMock } = makeDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.softDelete(messageId, senderId)).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns null when the sender is not an active participant", async () => {
    const { db, txSelect, updateMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repo = new MessagePgRepository(db);

    await expect(repo.softDelete(messageId, senderId)).resolves.toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns null when the message has already been revoked", async () => {
    const { db, txSelect, updateMock, updateWhereMock } = makeDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: senderId }]);
    const repo = new MessagePgRepository(db);

    await expect(repo.softDelete(messageId, senderId)).resolves.toBeNull();
    expect(updateMock).toHaveBeenCalledWith(messages);
    const scoped = render(updateWhereMock.mock.calls[0][0]);
    expect(scoped.sql).toContain('"messages"."deleted_at" is null');
    expect(scoped.params).toEqual([messageId, senderId]);
  });

  it("revokes the message and marks the conversation preview as revoked", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock, updateReturningMock } = makeDb();
    const revoked: Message = {
      ...existingRow,
      body: null,
      deletedAt: new Date("2026-10-19T01:00:00Z"),
    };
    txSelect.limitMock
      .mockResolvedValueOnce([{ conversationId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: senderId }]);
    updateReturningMock.mockResolvedValueOnce([revoked]);
    const repo = new MessagePgRepository(db);

    const result = await repo.softDelete(messageId, senderId);

    expect(result).toEqual(revoked);
    expect(updateMock).toHaveBeenNthCalledWith(1, messages);
    expect(updateMock).toHaveBeenNthCalledWith(2, conversations);
    const messageValues = setMock.mock.calls[0][0] as { deletedAt: SQL };
    expect(render(messageValues.deletedAt).sql).toBe("now()");
    const conversationValues = setMock.mock.calls[1][0] as {
      unreadRevision: SQL;
      lastMessagePreview: SQL;
    };
    expect(render(conversationValues.unreadRevision).sql).toContain(
      '"conversations"."unread_revision" + 1',
    );
    const preview = render(conversationValues.lastMessagePreview);
    expect(preview.sql).toContain('CASE WHEN "conversations"."last_message_id" =');
    expect(preview.params).toEqual([messageId, MESSAGE_REVOKED_PREVIEW_TOKEN]);
    expect(render(updateWhereMock.mock.calls[1][0]).params).toEqual([revoked.conversationId]);
  });
});
