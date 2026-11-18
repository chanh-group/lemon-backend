import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { ConversationPgRepository } from "../../../../src/domain/conversation/pg.js";
import {
  conversationParticipants,
  conversations,
} from "../../../../src/domain/conversation/schema.js";
import { messages } from "../../../../src/domain/message/schema.js";
import { users } from "../../../../src/domain/user/schema.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";

function makeSelectChain() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>();
  const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
  const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>();
  const leftJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>();
  const joinChain = { where: whereMock, innerJoin: innerJoinMock, leftJoin: leftJoinMock };
  innerJoinMock.mockReturnValue(joinChain);
  leftJoinMock.mockReturnValue(joinChain);
  const fromMock = vi.fn(() => joinChain);
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return { selectMock, fromMock, whereMock, innerJoinMock, leftJoinMock, limitMock };
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

function makeCountUnreadChain() {
  const whereMock = vi.fn<(condition: SQL) => Promise<unknown[]>>();
  const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>(() => ({
    where: whereMock,
  }));
  const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
  const selectMock = vi.fn<(columns: unknown) => unknown>(() => ({ from: fromMock }));

  return { selectMock, fromMock, innerJoinMock, whereMock };
}

function makeUpdateChain() {
  const txSelect = makeSelectChain();
  const forMock = vi.fn(() => ({ limit: txSelect.limitMock }));
  txSelect.whereMock.mockReturnValue({ limit: txSelect.limitMock, for: forMock });
  const whereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const setMock = vi.fn<(values: unknown) => unknown>(() => ({ where: whereMock }));
  const updateMock = vi.fn<(table: unknown) => unknown>(() => ({ set: setMock }));
  txSelect.limitMock
    .mockResolvedValueOnce([{ id: convRow.id }])
    .mockResolvedValueOnce([{ lastReadMessageId: null, historyBoundaryMessageId: null }])
    .mockResolvedValueOnce([
      { id: "0193a2b1-0000-7000-8000-000000000099", createdAt: new Date("2026-10-19T02:00:00Z") },
    ]);
  const transactionMock = vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({ select: txSelect.selectMock, update: updateMock }),
  );
  const db = { transaction: transactionMock } as unknown as DrizzleDb;

  return { db, updateMock, setMock, whereMock, transactionMock, txSelect };
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

describe("ConversationPgRepository group avatar", () => {
  it("returns the avatar only for an active group", async () => {
    const { db, dbSelect } = makeDb();
    const groupId = "0193a2b1-0000-7000-8000-000000000010";
    dbSelect.limitMock.mockResolvedValueOnce([{ avatarUrl: "https://api.example.com/group.png" }]);

    expect(await new ConversationPgRepository(db).getGroupAvatarUrl(groupId)).toBe(
      "https://api.example.com/group.png",
    );
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."kind" =');
    expect(lookup.sql).toContain('"conversations"."deleted_at" is null');
    expect(lookup.params).toEqual([groupId, "GROUP"]);
  });

  it("writes a new avatar when the actor is an active group admin", async () => {
    const groupLimit = vi
      .fn()
      .mockResolvedValue([{ id: convRow.id, kind: "GROUP", deletedAt: null, avatarUrl: null }]);
    const roleLimit = vi.fn().mockResolvedValue([{ role: "ADMIN" }]);
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ for: () => ({ limit: groupLimit }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: roleLimit }) }) });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const tx = { select, update };
    const db = {
      transaction: (cb: (value: typeof tx) => Promise<void>) => cb(tx),
    } as unknown as DrizzleDb;
    const url = "https://api.example.com/group.png";

    await new ConversationPgRepository(db).updateGroupAvatar(convRow.id, userAId, url);

    expect(set).toHaveBeenCalledWith({ avatarUrl: url, updatedAt: expect.anything() });
    expect(update).toHaveBeenCalledWith(conversations);
  });
});

describe("ConversationPgRepository.disbandGroup", () => {
  function makeDisbandDb(role: "ADMIN" | "MEMBER") {
    const active = [
      { userId: userAId, role },
      { userId: userBId, role: "MEMBER" as const },
    ];
    const groupLimit = vi.fn().mockResolvedValue([{ kind: "GROUP", deletedAt: null }]);
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ for: () => ({ limit: groupLimit }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: async () => active }) });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const tx = { select, update };
    const db = {
      transaction: (cb: (value: typeof tx) => Promise<string[]>) => cb(tx),
    } as unknown as DrizzleDb;
    return { db, set, update };
  }

  it("closes a group and revokes every active participant for an admin", async () => {
    const { db, set, update } = makeDisbandDb("ADMIN");

    expect(await new ConversationPgRepository(db).disbandGroup(convRow.id, userAId)).toEqual([
      userAId,
      userBId,
    ]);
    expect(update).toHaveBeenNthCalledWith(1, conversationParticipants);
    expect(update).toHaveBeenNthCalledWith(2, conversations);
    expect(set).toHaveBeenNthCalledWith(1, { leftAt: expect.anything() });
    expect(set).toHaveBeenNthCalledWith(2, {
      deletedAt: expect.anything(),
      updatedAt: expect.anything(),
    });
  });

  it("does not change the group for a regular member", async () => {
    const { db, update } = makeDisbandDb("MEMBER");

    await expect(
      new ConversationPgRepository(db).disbandGroup(convRow.id, userAId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.leaveGroup admin continuity", () => {
  function makeLeaveDb(active: { userId: string; role: "ADMIN" | "MEMBER" }[]) {
    const groupLimit = vi.fn().mockResolvedValue([{ kind: "GROUP" }]);
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ for: () => ({ limit: groupLimit }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: async () => active }) });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const tx = { select, update };
    const db = {
      transaction: (cb: (value: typeof tx) => Promise<{ closed: boolean }>) => cb(tx),
    } as unknown as DrizzleDb;
    return { db, set, update };
  }

  it("requires the last admin to promote another member before leaving", async () => {
    const { db, update } = makeLeaveDb([
      { userId: userAId, role: "ADMIN" },
      { userId: userBId, role: "MEMBER" },
    ]);

    await expect(
      new ConversationPgRepository(db).leaveGroup(convRow.id, userAId),
    ).rejects.toMatchObject({
      code: "LAST_ADMIN_REQUIRED",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an admin to leave after another admin exists", async () => {
    const { db, set, update } = makeLeaveDb([
      { userId: userAId, role: "ADMIN" },
      { userId: userBId, role: "ADMIN" },
    ]);

    expect(await new ConversationPgRepository(db).leaveGroup(convRow.id, userAId)).toEqual({
      closed: false,
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(1, { leftAt: expect.anything() });
  });
});

describe("ConversationPgRepository.createDirectConversation", () => {
  it("returns the existing conversation when a concurrent insert hits the unique index", async () => {
    const { db, dbSelect, transactionMock } = makeDb();
    transactionMock.mockRejectedValueOnce(uniqueViolation);
    dbSelect.limitMock.mockResolvedValueOnce([{ ...convRow, partner: partnerRow }]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createDirectConversation(userAId, userBId);

    expect(result).toEqual({ ...convRow, partner: partnerRow });
    expect(dbSelect.fromMock).toHaveBeenNthCalledWith(1, conversations);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."direct_key" =');
    expect(lookup.sql).toContain('"conversations"."deleted_at" is null');
    expect(lookup.params).toEqual([directKey]);
    expect(dbSelect.fromMock).toHaveBeenCalledTimes(1);
    expect(dbSelect.innerJoinMock).toHaveBeenCalledWith(users, expect.anything());
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
      lastMessageSenderId: null,
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
      {
        conversationId: newConvRow.id,
        userId: userAId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
      {
        conversationId: newConvRow.id,
        userId: userBId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
    ]);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
  });

  it("stores participants in canonical ID order regardless of the caller order", async () => {
    const { db, txSelect, insertMock, valuesMock, returningMock } = makeDb();
    const partnerA = { ...partnerRow, id: userAId, username: "alice" };
    txSelect.limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([partnerA]);
    returningMock.mockResolvedValueOnce([newConvRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createDirectConversation(userBId, userAId);

    expect(result.partner).toEqual(partnerA);
    expect(valuesMock).toHaveBeenNthCalledWith(1, { kind: "DIRECT", directKey });
    expect(insertMock).toHaveBeenNthCalledWith(2, conversationParticipants);
    expect(valuesMock).toHaveBeenNthCalledWith(2, [
      {
        conversationId: newConvRow.id,
        userId: userAId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
      {
        conversationId: newConvRow.id,
        userId: userBId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
    ]);
  });
});

describe("ConversationPgRepository.countUnread", () => {
  it("counts non-deleted messages from others newer than the participant's last read", async () => {
    const chain = makeCountUnreadChain();
    chain.whereMock.mockResolvedValue([{ count: 3 }]);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    const result = await repo.countUnread(convRow.id, userAId);

    expect(result).toBe(3);
    expect(chain.fromMock).toHaveBeenCalledWith(messages);

    const projection = chain.selectMock.mock.calls[0][0] as { count: SQL };
    expect(render(projection.count).sql).toContain("count(*)::int");

    expect(chain.innerJoinMock).toHaveBeenCalledWith(conversationParticipants, expect.anything());
    const join = render(chain.innerJoinMock.mock.calls[0][1]);
    expect(join.sql).toContain(
      '"conversation_participants"."conversation_id" = "messages"."conversation_id"',
    );
    expect(join.sql).toContain('"conversation_participants"."user_id" =');
    expect(join.params).toEqual([userAId]);

    const where = render(chain.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"messages"."conversation_id" =');
    expect(where.sql).toContain('"messages"."deleted_at" is null');
    expect(where.sql).toContain('"messages"."sender_id" <>');
    expect(where.sql).toContain('"conversation_participants"."last_read_message_id" is null');
    expect(where.sql).toContain('"messages"."created_at" >=');
    expect(where.sql).toContain('ROW("messages"."created_at", "messages"."id") > ROW(');
    expect(where.sql).toContain("SELECT m.created_at FROM messages m");
    expect(where.sql).toContain('"history_boundary_message_id" IS NULL');
    expect(where.sql).toContain('m.id = "conversation_participants"."last_read_message_id"');
    expect(where.params).toEqual([convRow.id, userAId, userAId]);
  });

  it("returns 0 when the aggregate row reports zero", async () => {
    const chain = makeCountUnreadChain();
    chain.whereMock.mockResolvedValue([{ count: 0 }]);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.countUnread(convRow.id, userAId)).resolves.toBe(0);
  });

  it("falls back to 0 when the database returns no aggregate row", async () => {
    const chain = makeCountUnreadChain();
    chain.whereMock.mockResolvedValue([]);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.countUnread(convRow.id, userAId)).resolves.toBe(0);
  });
});

describe("ConversationPgRepository.countUnreadByConversationIds", () => {
  it("groups counts per conversation behind the same sargable created-at pre-filter", async () => {
    const groupByMock = vi
      .fn<(condition: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([{ conversationId: convRow.id, count: 2 }]);
    const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ groupBy: groupByMock }));
    const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>(() => ({
      where: whereMock,
    }));
    const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
    const selectMock = vi.fn<(columns: unknown) => unknown>(() => ({ from: fromMock }));
    const db = { select: selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    const result = await repo.countUnreadByConversationIds([convRow.id], userAId);

    expect(result).toEqual(new Map([[convRow.id, 2]]));
    expect(fromMock).toHaveBeenCalledWith(messages);
    const where = render(whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"messages"."conversation_id" in');
    expect(where.sql).toContain('"messages"."created_at" >=');
    expect(where.sql).toContain('ROW("messages"."created_at", "messages"."id") > ROW(');
    expect(where.sql).toContain("NOT EXISTS (SELECT 1 FROM message_hidden_for_users h");
    expect(where.params).toEqual([convRow.id, userAId, userAId]);
  });

  it("returns an empty map without querying when given no conversation ids", async () => {
    const selectMock = vi.fn();
    const db = { select: selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.countUnreadByConversationIds([], userAId)).resolves.toEqual(new Map());
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.updateLastRead", () => {
  it("only advances the read marker using message creation time and ID", async () => {
    const chain = makeUpdateChain();
    const repo = new ConversationPgRepository(chain.db);

    await repo.updateLastRead(convRow.id, userAId, "0193a2b1-0000-7000-8000-000000000099");

    expect(chain.updateMock).toHaveBeenCalledWith(conversationParticipants);
    const values = chain.setMock.mock.calls[0][0] as { lastReadAt: SQL };
    expect(render(values.lastReadAt).sql).toBe("now()");
    const where = render(chain.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."conversation_id" =');
    expect(where.sql).toContain('"conversation_participants"."user_id" =');
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
  });
});

describe("ConversationPgRepository.isMessageInConversation", () => {
  it("looks up the message by id and conversation without filtering deleted messages", async () => {
    const chain = makeSelectChain();
    chain.limitMock.mockResolvedValueOnce([{ id: "msg-1" }]);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    const result = await repo.isMessageInConversation(convRow.id, "msg-1");

    expect(result).toBe(true);
    expect(chain.fromMock).toHaveBeenCalledWith(messages);
    expect(chain.limitMock).toHaveBeenCalledWith(1);

    const where = render(chain.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"messages"."id" =');
    expect(where.sql).toContain('"messages"."conversation_id" =');
    expect(where.sql).not.toContain("deleted_at");
    expect(where.params).toEqual(["msg-1", convRow.id]);
  });

  it("returns false when the message does not belong to the conversation", async () => {
    const chain = makeSelectChain();
    chain.limitMock.mockResolvedValueOnce([]);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.isMessageInConversation(convRow.id, "missing")).resolves.toBe(false);
  });
});

describe("ConversationPgRepository.findById", () => {
  it("loads the conversation, active membership, and active partner in one query", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      {
        ...convRow,
        lastReadMessageId: null,
        partnerId: partnerRow.id,
        partnerUsername: partnerRow.username,
        partnerFullName: partnerRow.fullName,
        partnerAvatarUrl: partnerRow.avatarUrl,
      },
    ]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findById(convRow.id, userAId);

    expect(result).toMatchObject({
      id: convRow.id,
      lastReadMessageId: null,
      partner: { id: userBId, username: "bob" },
    });
    expect(dbSelect.limitMock).toHaveBeenCalledTimes(1);
    const membership = render(dbSelect.innerJoinMock.mock.calls[0][1]);
    expect(membership.sql).toContain('"conversation_participants"."user_id" =');
    expect(membership.sql).toContain('"conversation_participants"."left_at" is null');
    expect(membership.params).toEqual([userAId]);
    const partnerJoin = render(dbSelect.leftJoinMock.mock.calls[0][1]);
    expect(partnerJoin.sql).toContain('"partner_participants"."left_at" is null');
    expect(partnerJoin.params).toEqual(["DIRECT", userAId]);
  });

  it("returns null when the participant has left the conversation", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.findById(convRow.id, userAId)).resolves.toBeNull();
  });
});
