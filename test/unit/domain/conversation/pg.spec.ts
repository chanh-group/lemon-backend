import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { GROUP_MAX_MEMBERS } from "../../../../src/domain/conversation/constants.js";
import { ConversationPgRepository } from "../../../../src/domain/conversation/pg.js";
import {
  avatarCleanupJobs,
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

function makeTxSelect() {
  const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>().mockResolvedValue([]);
  const thenable = {
    limit: limitMock,
    // oxlint-disable-next-line unicorn/no-thenable
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      limitMock(0).then(resolve, reject),
  };
  const forMock = vi.fn<(...args: unknown[]) => unknown>(() => thenable);
  const orderByMock = vi.fn<(...args: unknown[]) => unknown>(() => thenable);
  const groupByMock = vi.fn<(...args: unknown[]) => unknown>(() => thenable);
  const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({
    limit: limitMock,
    for: forMock,
    orderBy: orderByMock,
    groupBy: groupByMock,
    // oxlint-disable-next-line unicorn/no-thenable
    then: thenable.then,
  }));
  const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>();
  const leftJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>();
  const joinChain = { where: whereMock, innerJoin: innerJoinMock, leftJoin: leftJoinMock };
  innerJoinMock.mockReturnValue(joinChain);
  leftJoinMock.mockReturnValue(joinChain);
  const fromMock = vi.fn<(table: unknown) => unknown>(() => joinChain);
  const selectMock = vi.fn<(columns?: unknown) => unknown>(() => ({ from: fromMock }));

  return {
    selectMock,
    fromMock,
    whereMock,
    innerJoinMock,
    leftJoinMock,
    forMock,
    orderByMock,
    groupByMock,
    limitMock,
  };
}

function makeTxDb() {
  const txSelect = makeTxSelect();
  const dbSelect = makeTxSelect();

  const returningMock = vi.fn<(cols?: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const onConflictDoNothingMock = vi
    .fn<(config?: unknown) => Promise<unknown>>()
    .mockResolvedValue([]);
  const onConflictDoUpdateMock = vi
    .fn<(config: unknown) => Promise<unknown>>()
    .mockResolvedValue([]);
  const valuesMock = vi.fn<(values: unknown) => unknown>(() => ({
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
    onConflictDoUpdate: onConflictDoUpdateMock,
  }));
  const insertMock = vi.fn<(table: unknown) => unknown>(() => ({ values: valuesMock }));

  const updateWhereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const setMock = vi.fn<(values: unknown) => unknown>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<(table: unknown) => unknown>(() => ({ set: setMock }));

  const deleteWhereMock = vi.fn<(condition: SQL) => Promise<unknown>>().mockResolvedValue([]);
  const deleteMock = vi.fn<(table: unknown) => unknown>(() => ({ where: deleteWhereMock }));

  const tx = {
    select: txSelect.selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  };
  const transactionMock = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = {
    select: dbSelect.selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
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
    onConflictDoUpdateMock,
    updateMock,
    setMock,
    updateWhereMock,
    deleteMock,
    deleteWhereMock,
    transactionMock,
  };
}

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);

afterEach(() => {
  vi.unstubAllEnvs();
});

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
const groupUniqueViolation = { code: "23505", constraint: "conversations_group_request_uq" };
const userCId = "0193a2b1-0000-7000-8000-000000000003";
const msgId = "0193a2b1-0000-7000-8000-000000000040";
const groupTitle = "Team Lemon";
const createRequest = {
  creatorId: userAId,
  title: groupTitle,
  memberIds: [userBId],
  clientRequestId: "0193a2b1-0000-7000-8000-0000000000c1",
  createRequestHash: "hash-abc",
};

const groupFindCursorRow = {
  id: convRow.id,
  kind: "GROUP" as const,
  directKey: null,
  lastMessagePreview: null,
  lastMessageSenderId: null,
  lastMessageAt: null,
  createdAt: convRow.createdAt,
  lastReadMessageId: null,
  unreadRevision: "0",
  partnerId: null,
  partnerUsername: null,
  partnerFullName: null,
  partnerAvatarUrl: null,
  lastMessageSenderUserId: null,
  lastMessageSenderUsername: null,
  lastMessageSenderFullName: null,
  lastMessageSenderAvatarUrl: null,
  title: groupTitle,
  avatarUrl: null,
  myRole: "ADMIN" as const,
  memberCount: 2,
  historyBoundaryMessageId: null,
  historyBoundaryWasEmpty: true,
  joinGeneration: "1",
  lastReadAt: null,
};

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

  it("checks group membership and avatar URL in one statement", async () => {
    const { db, dbSelect } = makeDb();
    const groupId = "0193a2b1-0000-7000-8000-000000000010";
    dbSelect.limitMock.mockResolvedValueOnce([{ avatarUrl: "https://api.example.com/group.png" }]);

    expect(
      await new ConversationPgRepository(db).getAccessibleGroupAvatarUrl(groupId, userAId),
    ).toEqual({ avatarUrl: "https://api.example.com/group.png" });
    expect(dbSelect.innerJoinMock).toHaveBeenCalledWith(
      conversationParticipants,
      expect.anything(),
    );
    const join = render(dbSelect.innerJoinMock.mock.calls[0][1]);
    expect(join.sql).toContain('"conversation_participants"."left_at" is null');
    expect(join.params).toContain(userAId);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
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

  it("returns null when the group avatar lookup finds no active group", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);

    await expect(
      new ConversationPgRepository(db).getGroupAvatarUrl(convRow.id),
    ).resolves.toBeNull();
  });

  it("returns null when the requester is not an active group member", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);

    await expect(
      new ConversationPgRepository(db).getAccessibleGroupAvatarUrl(convRow.id, userAId),
    ).resolves.toBeNull();
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

  it("schedules avatar cleanup before revoking every participant", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const avatarUrl =
      "https://api.example.com/api/files/group-avatars/" +
      `${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`;
    const groupLimit = vi.fn().mockResolvedValue([{ kind: "GROUP", deletedAt: null, avatarUrl }]);
    const active = [{ userId: userAId, role: "ADMIN" as const }];
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ for: () => ({ limit: groupLimit }) }) }),
      })
      .mockReturnValueOnce({ from: () => ({ where: async () => active }) });
    const onConflictDoNothing = vi.fn().mockResolvedValue([]);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const tx = { select, insert, update };
    const db = {
      transaction: (cb: (value: typeof tx) => Promise<string[]>) => cb(tx),
    } as unknown as DrizzleDb;

    expect(await new ConversationPgRepository(db).disbandGroup(convRow.id, userAId)).toEqual([
      userAId,
    ]);
    expect(insert).toHaveBeenCalledWith(avatarCleanupJobs);
    expect(values).toHaveBeenCalledWith({
      id: expect.any(String),
      conversationId: convRow.id,
      objectKey: `group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`,
      status: "PENDING",
    });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenNthCalledWith(1, { leftAt: expect.anything() });
    expect(set).toHaveBeenNthCalledWith(2, {
      deletedAt: expect.anything(),
      updatedAt: expect.anything(),
    });
  });

  it("throws CONVERSATION_NOT_FOUND when the conversation is missing or soft-deleted", async () => {
    const groupLimit = vi.fn().mockResolvedValue([]);
    const select = vi.fn().mockReturnValueOnce({
      from: () => ({ where: () => ({ for: () => ({ limit: groupLimit }) }) }),
    });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const tx = { select, update };
    const db = {
      transaction: (cb: (value: typeof tx) => Promise<string[]>) => cb(tx),
    } as unknown as DrizzleDb;

    await expect(
      new ConversationPgRepository(db).disbandGroup(convRow.id, userAId),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
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

  it("reuses the conversation found inside the transaction and resolves the last sender", async () => {
    const { db, txSelect, insertMock, onConflictDoNothingMock } = makeDb();
    const lastMessageAt = new Date("2026-10-19T08:00:00Z");
    txSelect.limitMock
      .mockResolvedValueOnce([
        {
          ...convRow,
          lastMessageId: msgId,
          lastMessagePreview: "yo",
          lastMessageAt,
        },
      ])
      .mockResolvedValueOnce([{ senderId: userAId }])
      .mockResolvedValueOnce([partnerRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createDirectConversation(userAId, userBId);

    expect(result).toEqual({
      id: convRow.id,
      kind: "DIRECT",
      directKey,
      lastMessagePreview: "yo",
      lastMessageSenderId: userAId,
      lastMessageAt,
      createdAt: convRow.createdAt,
      partner: partnerRow,
    });
    const preCheck = render(txSelect.whereMock.mock.calls[0][0]);
    expect(preCheck.sql).toContain('"conversations"."direct_key" =');
    expect(preCheck.params).toEqual([directKey]);
    const senderLookup = render(txSelect.whereMock.mock.calls[1][0]);
    expect(senderLookup.sql).toContain('"messages"."id" =');
    expect(senderLookup.params).toEqual([msgId]);
    const partnerLookup = render(txSelect.whereMock.mock.calls[2][0]);
    expect(partnerLookup.sql).toContain('"users"."id" =');
    expect(partnerLookup.params).toEqual([userBId]);
    expect(insertMock).toHaveBeenCalledWith(conversationParticipants);
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
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

describe("ConversationPgRepository.createGroup", () => {
  const newGroupRow = {
    id: "0193a2b1-0000-7000-8000-000000000050",
    title: groupTitle,
    avatarUrl: null,
    createdAt: new Date("2026-10-19T03:00:00Z"),
  };
  const groupFindResult = {
    id: convRow.id,
    kind: "GROUP" as const,
    directKey: null,
    lastMessagePreview: null,
    lastMessageSenderId: null,
    lastMessageSender: undefined,
    lastMessageAt: null,
    title: groupTitle,
    avatarUrl: null,
    myRole: "ADMIN" as const,
    memberCount: 2,
    historyBoundaryMessageId: null,
    historyBoundaryWasEmpty: true,
    joinGeneration: "1",
    lastReadAt: null,
    createdAt: convRow.createdAt,
    partner: undefined,
    lastReadMessageId: null,
    unreadRevision: "0",
  };

  it("returns the recorded conversation without writing when the same request already exists", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock
      .mockResolvedValueOnce([
        { id: convRow.id, deletedAt: null, createRequestHash: createRequest.createRequestHash },
      ])
      .mockResolvedValueOnce([groupFindCursorRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createGroup(createRequest);

    expect(result).toEqual({ conversation: groupFindResult, created: false });
    expect(transactionMock).not.toHaveBeenCalled();
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."creator_id" =');
    expect(lookup.sql).toContain('"conversations"."create_request_id" =');
    expect(lookup.sql).toContain('"conversations"."kind" =');
    expect(lookup.params).toEqual([
      createRequest.creatorId,
      createRequest.clientRequestId,
      "GROUP",
    ]);
  });

  it("rejects with CONFLICT when the recorded request was soft-deleted", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      {
        id: convRow.id,
        deletedAt: new Date("2026-10-19T04:00:00Z"),
        createRequestHash: createRequest.createRequestHash,
      },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with CONFLICT when the recorded request carries a different hash", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      { id: convRow.id, deletedAt: null, createRequestHash: "other-hash" },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects with NOT_PARTICIPANT when the creator can no longer read the recorded group", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock
      .mockResolvedValueOnce([
        { id: convRow.id, deletedAt: null, createRequestHash: createRequest.createRequestHash },
      ])
      .mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });
  });

  it("creates the group, seats the members and returns created true", async () => {
    const { db, dbSelect, transactionMock, insertMock, valuesMock, returningMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    returningMock.mockResolvedValueOnce([newGroupRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createGroup(createRequest);

    expect(result).toEqual({
      conversation: {
        id: newGroupRow.id,
        kind: "GROUP",
        directKey: null,
        title: groupTitle,
        avatarUrl: null,
        memberCount: 2,
        myRole: "ADMIN",
        joinGeneration: "1",
        lastMessagePreview: null,
        lastMessageAt: null,
        createdAt: newGroupRow.createdAt,
      },
      created: true,
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenNthCalledWith(1, conversations);
    expect(valuesMock).toHaveBeenNthCalledWith(1, {
      kind: "GROUP",
      title: groupTitle,
      creatorId: userAId,
      createRequestId: createRequest.clientRequestId,
      createRequestHash: createRequest.createRequestHash,
    });
    expect(insertMock).toHaveBeenNthCalledWith(2, conversationParticipants);
    expect(valuesMock).toHaveBeenNthCalledWith(2, [
      {
        conversationId: newGroupRow.id,
        userId: userAId,
        role: "ADMIN",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
      {
        conversationId: newGroupRow.id,
        userId: userBId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
    ]);
  });

  it("reuses the winning conversation when a concurrent create hits the group request index", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: convRow.id, deletedAt: null, createRequestHash: createRequest.createRequestHash },
      ])
      .mockResolvedValueOnce([groupFindCursorRow]);
    transactionMock.mockRejectedValueOnce(groupUniqueViolation);
    const repo = new ConversationPgRepository(db);

    const result = await repo.createGroup(createRequest);

    expect(result).toEqual({ conversation: groupFindResult, created: false });
    const retry = render(dbSelect.whereMock.mock.calls[1][0]);
    expect(retry.sql).toContain('"conversations"."creator_id" =');
    expect(retry.sql).toContain('"conversations"."create_request_id" =');
    expect(retry.sql).not.toContain('"conversations"."kind"');
    expect(retry.params).toEqual([createRequest.creatorId, createRequest.clientRequestId]);
  });

  it("rejects with CONFLICT when the retry lookup finds a deleted winner", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: convRow.id,
        deletedAt: new Date("2026-10-19T04:00:00Z"),
        createRequestHash: createRequest.createRequestHash,
      },
    ]);
    transactionMock.mockRejectedValueOnce(groupUniqueViolation);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects with CONFLICT when the retry lookup finds a different hash", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: convRow.id, deletedAt: null, createRequestHash: "other-hash" },
      ]);
    transactionMock.mockRejectedValueOnce(groupUniqueViolation);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects with CONFLICT when the retry lookup cannot find the winner", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    transactionMock.mockRejectedValueOnce(groupUniqueViolation);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows an insert error that is not the group request unique violation", async () => {
    const { db, dbSelect, transactionMock } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const infraError = { code: "23503", constraint: "conversations_creator_fk" };
    transactionMock.mockRejectedValueOnce(infraError);
    const repo = new ConversationPgRepository(db);

    await expect(repo.createGroup(createRequest)).rejects.toBe(infraError);
    expect(dbSelect.selectMock).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationPgRepository.findGroupCreateRequest", () => {
  it("returns the recorded create request for the creator", async () => {
    const { db, dbSelect } = makeTxDb();
    const row = {
      id: convRow.id,
      createRequestHash: createRequest.createRequestHash,
      deletedAt: null,
    };
    dbSelect.limitMock.mockResolvedValueOnce([row]);
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.findGroupCreateRequest(createRequest.creatorId, createRequest.clientRequestId),
    ).resolves.toEqual(row);
    const lookup = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."creator_id" =');
    expect(lookup.sql).toContain('"conversations"."create_request_id" =');
    expect(lookup.sql).toContain('"conversations"."kind" =');
    expect(lookup.params).toEqual([
      createRequest.creatorId,
      createRequest.clientRequestId,
      "GROUP",
    ]);
  });

  it("returns null when no create request is recorded", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.findGroupCreateRequest(createRequest.creatorId, createRequest.clientRequestId),
    ).resolves.toBeNull();
  });
});

describe("ConversationPgRepository.addGroupMembers", () => {
  const lastAt = new Date("2026-10-19T05:00:00Z");

  function mockHappyQueries(
    txSelect: ReturnType<typeof makeTxSelect>,
    options: { latestMsg?: { id: string } | null; active?: { userId: string }[] } = {},
  ) {
    txSelect.limitMock
      .mockResolvedValueOnce([
        {
          id: convRow.id,
          kind: "GROUP",
          deletedAt: null,
          title: groupTitle,
          avatarUrl: null,
          lastMessagePreview: "hey",
          lastMessageAt: lastAt,
          createdAt: convRow.createdAt,
        },
      ])
      .mockResolvedValueOnce([{ role: "ADMIN" }])
      .mockResolvedValueOnce(options.active ?? [{ userId: userAId }, { userId: userBId }])
      .mockResolvedValueOnce([{ id: userCId, isActive: true }])
      .mockResolvedValueOnce(
        options.latestMsg === undefined ? [{ id: msgId }] : [options.latestMsg].filter(Boolean),
      );
  }

  it("adds members under the group row lock and reports the updated member count", async () => {
    const {
      db,
      txSelect,
      insertMock,
      valuesMock,
      onConflictDoUpdateMock,
      updateMock,
      setMock,
      updateWhereMock,
    } = makeTxDb();
    mockHappyQueries(txSelect);
    const repo = new ConversationPgRepository(db);

    const result = await repo.addGroupMembers(convRow.id, userAId, [userCId]);

    expect(result).toEqual({
      id: convRow.id,
      kind: "GROUP",
      directKey: null,
      title: groupTitle,
      avatarUrl: null,
      lastMessagePreview: "hey",
      lastMessageAt: lastAt,
      createdAt: convRow.createdAt,
      myRole: "ADMIN",
      memberCount: 3,
    });
    expect(txSelect.forMock).toHaveBeenCalledTimes(2);
    expect(txSelect.forMock).toHaveBeenNthCalledWith(1, "update");
    expect(txSelect.forMock).toHaveBeenNthCalledWith(2, "update");
    const groupLock = render(txSelect.whereMock.mock.calls[0][0]);
    expect(groupLock.sql).toContain('"conversations"."id" =');
    expect(groupLock.params).toEqual([convRow.id]);
    const actorLock = render(txSelect.whereMock.mock.calls[1][0]);
    expect(actorLock.sql).toContain('"conversation_participants"."left_at" is null');
    expect(actorLock.params).toEqual([convRow.id, userAId]);
    const userLookup = render(txSelect.whereMock.mock.calls[3][0]);
    expect(userLookup.sql).toContain('"users"."id" in');
    expect(userLookup.params).toEqual([userCId]);

    expect(insertMock).toHaveBeenCalledWith(conversationParticipants);
    expect(valuesMock).toHaveBeenCalledWith([
      {
        conversationId: convRow.id,
        userId: userCId,
        role: "MEMBER",
        historyBoundaryMessageId: msgId,
        historyBoundaryWasEmpty: false,
        joinGeneration: 1n,
      },
    ]);
    const conflict = onConflictDoUpdateMock.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
      where: SQL;
    };
    expect(conflict.target).toEqual([
      conversationParticipants.conversationId,
      conversationParticipants.userId,
    ]);
    expect(conflict.set.role).toBe("MEMBER");
    expect(conflict.set.leftAt).toBeNull();
    expect(conflict.set.lastReadMessageId).toBe(msgId);
    expect(conflict.set.historyBoundaryMessageId).toBe(msgId);
    expect(conflict.set.historyBoundaryWasEmpty).toBe(false);
    expect(render(conflict.set.joinedAt as SQL).sql).toBe("clock_timestamp()");
    expect(render(conflict.set.lastReadAt as SQL).sql).toBe("clock_timestamp()");
    expect(render(conflict.set.joinGeneration as SQL).sql).toContain(
      '"conversation_participants"."join_generation" + 1',
    );
    expect(render(conflict.where).sql).toContain(
      '"conversation_participants"."left_at" IS NOT NULL',
    );

    expect(updateMock).toHaveBeenCalledWith(conversations);
    const revision = setMock.mock.calls[0][0] as { unreadRevision: SQL };
    expect(render(revision.unreadRevision).sql).toContain('"conversations"."unread_revision" + 1');
    const bumpWhere = render(updateWhereMock.mock.calls[0][0]);
    expect(bumpWhere.params).toEqual([convRow.id]);
  });

  it("seats members with an empty-history boundary when the group has no messages", async () => {
    const { db, txSelect, valuesMock } = makeTxDb();
    mockHappyQueries(txSelect, { latestMsg: null });
    const repo = new ConversationPgRepository(db);

    await repo.addGroupMembers(convRow.id, userAId, [userCId]);

    expect(valuesMock).toHaveBeenCalledWith([
      {
        conversationId: convRow.id,
        userId: userCId,
        role: "MEMBER",
        historyBoundaryMessageId: null,
        historyBoundaryWasEmpty: true,
        joinGeneration: 1n,
      },
    ]);
  });

  it("throws CONVERSATION_NOT_FOUND when the group is soft-deleted", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    txSelect.limitMock.mockResolvedValueOnce([
      { id: convRow.id, kind: "GROUP", deletedAt: new Date("2026-10-19T06:00:00Z") },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the actor is not an active group admin", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ id: convRow.id, kind: "GROUP", deletedAt: null }])
      .mockResolvedValueOnce([{ role: "MEMBER" }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws CONFLICT when a member is already active in the group", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    mockHappyQueries(txSelect, { active: [{ userId: userAId }, { userId: userCId }] });
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws GROUP_FULL when the group is already at capacity", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    const full = Array.from({ length: GROUP_MAX_MEMBERS }, (_, index) => ({
      userId: `0193a2b1-0000-7000-8000-9${String(index).padStart(11, "0")}`,
    }));
    mockHappyQueries(txSelect, { active: full });
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "GROUP_FULL",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws USER_NOT_FOUND when an invited user does not exist", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ id: convRow.id, kind: "GROUP", deletedAt: null }])
      .mockResolvedValueOnce([{ role: "ADMIN" }])
      .mockResolvedValueOnce([{ userId: userAId }])
      .mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws USER_NOT_FOUND when an invited user is inactive", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ id: convRow.id, kind: "GROUP", deletedAt: null }])
      .mockResolvedValueOnce([{ role: "ADMIN" }])
      .mockResolvedValueOnce([{ userId: userAId }])
      .mockResolvedValueOnce([{ id: userCId, isActive: false }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.addGroupMembers(convRow.id, userAId, [userCId])).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.removeGroupMember", () => {
  function makeRemoveDb(
    options: { group?: unknown[]; actor?: unknown[]; target?: unknown[] } = {},
  ) {
    const t = makeTxDb();
    t.txSelect.limitMock
      .mockResolvedValueOnce(options.group ?? [{ kind: "GROUP" }])
      .mockResolvedValueOnce(options.actor ?? [{ role: "ADMIN" }])
      .mockResolvedValueOnce(options.target ?? [{ role: "MEMBER" }]);
    return t;
  }

  it("marks the member as left and bumps the unread revision under row locks", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock } = makeRemoveDb();
    const repo = new ConversationPgRepository(db);

    await repo.removeGroupMember(convRow.id, userAId, userCId);

    expect(txSelect.forMock).toHaveBeenCalledTimes(3);
    expect(txSelect.forMock).toHaveBeenCalledWith("update");
    expect(updateMock).toHaveBeenNthCalledWith(1, conversationParticipants);
    expect(updateMock).toHaveBeenNthCalledWith(2, conversations);
    const left = setMock.mock.calls[0][0] as { leftAt: SQL };
    expect(render(left.leftAt).sql).toBe("clock_timestamp()");
    const revokeWhere = render(updateWhereMock.mock.calls[0][0]);
    expect(revokeWhere.sql).toContain('"conversation_participants"."conversation_id" =');
    expect(revokeWhere.sql).toContain('"conversation_participants"."user_id" =');
    expect(revokeWhere.sql).toContain('"conversation_participants"."left_at" is null');
    expect(revokeWhere.params).toEqual([convRow.id, userCId]);
    const revision = setMock.mock.calls[1][0] as { unreadRevision: SQL };
    expect(render(revision.unreadRevision).sql).toContain('"conversations"."unread_revision" + 1');
  });

  it("throws FORBIDDEN when the actor is not an admin", async () => {
    const { db, updateMock } = makeRemoveDb({ actor: [{ role: "MEMBER" }] });
    const repo = new ConversationPgRepository(db);

    await expect(repo.removeGroupMember(convRow.id, userAId, userCId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the target is not an active member", async () => {
    const { db, updateMock } = makeRemoveDb({ target: [] });
    const repo = new ConversationPgRepository(db);

    await expect(repo.removeGroupMember(convRow.id, userAId, userCId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the actor tries to remove themselves", async () => {
    const { db, updateMock } = makeRemoveDb({
      actor: [{ role: "ADMIN" }],
      target: [{ role: "ADMIN" }],
    });
    const repo = new ConversationPgRepository(db);

    await expect(repo.removeGroupMember(convRow.id, userAId, userAId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws CONVERSATION_NOT_FOUND when the conversation is not a group", async () => {
    const { db, updateMock } = makeRemoveDb({ group: [{ kind: "DIRECT" }] });
    const repo = new ConversationPgRepository(db);

    await expect(repo.removeGroupMember(convRow.id, userAId, userCId)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.updateGroup", () => {
  function makeMetadataDb(group?: unknown, actor?: unknown[]) {
    const t = makeTxDb();
    t.txSelect.limitMock
      .mockResolvedValueOnce([
        group ?? { id: convRow.id, avatarUrl: null, kind: "GROUP", deletedAt: null },
      ])
      .mockResolvedValueOnce(actor ?? [{ role: "ADMIN" }]);
    return t;
  }

  it("writes the new title for an active group admin", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock } = makeMetadataDb();
    const repo = new ConversationPgRepository(db);

    await repo.updateGroup(convRow.id, userAId, "New title");

    expect(txSelect.forMock).toHaveBeenCalledTimes(1);
    expect(txSelect.forMock).toHaveBeenCalledWith("update");
    const lock = render(txSelect.whereMock.mock.calls[0][0]);
    expect(lock.sql).toContain('"conversations"."id" =');
    expect(lock.params).toEqual([convRow.id]);
    expect(updateMock).toHaveBeenCalledWith(conversations);
    const values = setMock.mock.calls[0][0] as { title: string; updatedAt: SQL };
    expect(values.title).toBe("New title");
    expect(render(values.updatedAt).sql).toBe("now()");
    const where = render(updateWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversations"."kind" =');
    expect(where.sql).toContain('"conversations"."deleted_at" is null');
    expect(where.params).toEqual([convRow.id, "GROUP"]);
  });

  it("schedules cleanup of the replaced avatar and writes the new URL", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const oldUrl = `https://api.example.com/api/files/group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`;
    const newUrl = `https://api.example.com/api/files/group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6c.png`;
    const { db, insertMock, valuesMock, onConflictDoNothingMock, setMock } = makeMetadataDb({
      id: convRow.id,
      avatarUrl: oldUrl,
      kind: "GROUP",
      deletedAt: null,
    });
    const repo = new ConversationPgRepository(db);

    await repo.updateGroupAvatar(convRow.id, userAId, newUrl);

    expect(insertMock).toHaveBeenCalledWith(avatarCleanupJobs);
    expect(valuesMock).toHaveBeenCalledWith({
      id: expect.any(String),
      conversationId: convRow.id,
      objectKey: `group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`,
      status: "PENDING",
    });
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
    const values = setMock.mock.calls[0][0] as { avatarUrl: string; updatedAt: SQL };
    expect(values.avatarUrl).toBe(newUrl);
    expect(render(values.updatedAt).sql).toBe("now()");
  });

  it("skips cleanup when the old avatar URL is not a managed group avatar", async () => {
    const { db, insertMock, setMock } = makeMetadataDb({
      id: convRow.id,
      avatarUrl: "https://cdn.example.com/legacy.png",
      kind: "GROUP",
      deletedAt: null,
    });
    const repo = new ConversationPgRepository(db);

    await repo.updateGroupAvatar(convRow.id, userAId, "https://cdn.example.com/legacy-2.png");

    expect(insertMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({
      avatarUrl: "https://cdn.example.com/legacy-2.png",
      updatedAt: expect.anything(),
    });
  });

  it("skips cleanup when the avatar URL is unchanged", async () => {
    const sameUrl = "https://cdn.example.com/same.png";
    const { db, insertMock } = makeMetadataDb({
      id: convRow.id,
      avatarUrl: sameUrl,
      kind: "GROUP",
      deletedAt: null,
    });
    const repo = new ConversationPgRepository(db);

    await repo.updateGroupAvatar(convRow.id, userAId, sameUrl);

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws CONVERSATION_NOT_FOUND when the group is soft-deleted", async () => {
    const { db, updateMock } = makeMetadataDb({
      id: convRow.id,
      avatarUrl: null,
      kind: "GROUP",
      deletedAt: new Date("2026-10-19T06:00:00Z"),
    });
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateGroup(convRow.id, userAId, "New title")).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws NOT_PARTICIPANT when the actor has no active membership", async () => {
    const { db, updateMock } = makeMetadataDb(undefined, []);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateGroup(convRow.id, userAId, "New title")).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the actor is only a member", async () => {
    const { db, updateMock } = makeMetadataDb(undefined, [{ role: "MEMBER" }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateGroup(convRow.id, userAId, "New title")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.updateMemberRole", () => {
  function makeRoleDb(options: { locked?: unknown[]; actor?: unknown[]; target?: unknown[] } = {}) {
    const t = makeTxDb();
    t.txSelect.limitMock
      .mockResolvedValueOnce(options.locked ?? [{ id: convRow.id }])
      .mockResolvedValueOnce(options.actor ?? [{ role: "ADMIN" }])
      .mockResolvedValueOnce(options.target ?? [{ role: "MEMBER" }]);
    return t;
  }

  it("promotes a member while holding the group row lock", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock } = makeRoleDb();
    const repo = new ConversationPgRepository(db);

    await repo.updateMemberRole(convRow.id, userAId, userCId, "ADMIN");

    expect(txSelect.forMock).toHaveBeenCalledTimes(1);
    expect(txSelect.forMock).toHaveBeenCalledWith("update");
    const lock = render(txSelect.whereMock.mock.calls[0][0]);
    expect(lock.sql).toContain('"conversations"."kind" =');
    expect(lock.sql).toContain('"conversations"."deleted_at" is null');
    expect(lock.params).toEqual([convRow.id, "GROUP"]);
    expect(updateMock).toHaveBeenCalledWith(conversationParticipants);
    expect(setMock).toHaveBeenCalledWith({ role: "ADMIN" });
    const where = render(updateWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."conversation_id" =');
    expect(where.sql).toContain('"conversation_participants"."user_id" =');
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id, userCId]);
  });

  it("throws CONVERSATION_NOT_FOUND when the group is gone", async () => {
    const { db, updateMock } = makeRoleDb({ locked: [] });
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.updateMemberRole(convRow.id, userAId, userCId, "ADMIN"),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the actor is not an admin", async () => {
    const { db, updateMock } = makeRoleDb({ actor: [{ role: "MEMBER" }] });
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.updateMemberRole(convRow.id, userAId, userCId, "ADMIN"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the target is not an active member", async () => {
    const { db, updateMock } = makeRoleDb({ target: [] });
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.updateMemberRole(convRow.id, userAId, userCId, "ADMIN"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when the actor changes their own role", async () => {
    const { db, updateMock } = makeRoleDb({
      actor: [{ role: "ADMIN" }],
      target: [{ role: "ADMIN" }],
    });
    const repo = new ConversationPgRepository(db);

    await expect(
      repo.updateMemberRole(convRow.id, userAId, userAId, "MEMBER"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.leaveGroup closing", () => {
  it("soft-deletes the group and schedules avatar cleanup when the last member leaves", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const avatarUrl = `https://api.example.com/api/files/group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`;
    const {
      db,
      txSelect,
      insertMock,
      valuesMock,
      onConflictDoNothingMock,
      updateMock,
      setMock,
      updateWhereMock,
    } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "GROUP", avatarUrl }])
      .mockResolvedValueOnce([{ userId: userAId, role: "MEMBER" }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.leaveGroup(convRow.id, userAId)).resolves.toEqual({ closed: true });

    expect(updateMock).toHaveBeenNthCalledWith(1, conversationParticipants);
    expect(updateMock).toHaveBeenNthCalledWith(2, conversations);
    const leaveWhere = render(updateWhereMock.mock.calls[0][0]);
    expect(leaveWhere.sql).toContain('"conversation_participants"."conversation_id" =');
    expect(leaveWhere.sql).toContain('"conversation_participants"."user_id" =');
    expect(leaveWhere.sql).not.toContain("left_at");
    expect(leaveWhere.params).toEqual([convRow.id, userAId]);

    expect(insertMock).toHaveBeenCalledWith(avatarCleanupJobs);
    expect(valuesMock).toHaveBeenCalledWith({
      id: expect.any(String),
      conversationId: convRow.id,
      objectKey: `group-avatars/${convRow.id}/0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png`,
      status: "PENDING",
    });
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);

    const closeValues = setMock.mock.calls[1][0] as { unreadRevision: SQL; deletedAt: SQL };
    expect(render(closeValues.deletedAt).sql).toBe("now()");
    expect(render(closeValues.unreadRevision).sql).toContain(
      '"conversations"."unread_revision" + 1',
    );
    const closeWhere = render(updateWhereMock.mock.calls[1][0]);
    expect(closeWhere.params).toEqual([convRow.id]);
  });

  it("skips avatar cleanup when the closing group has no managed avatar", async () => {
    const { db, txSelect, insertMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "GROUP", avatarUrl: null }])
      .mockResolvedValueOnce([{ userId: userAId, role: "MEMBER" }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.leaveGroup(convRow.id, userAId)).resolves.toEqual({ closed: true });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("throws CONVERSATION_NOT_FOUND when the conversation is not a group", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.leaveGroup(convRow.id, userAId)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws NOT_PARTICIPANT when the user has no active membership", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{ kind: "GROUP", avatarUrl: null }])
      .mockResolvedValueOnce([{ userId: userBId, role: "MEMBER" }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.leaveGroup(convRow.id, userAId)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.listMembers", () => {
  it("lists active members joined to their user rows in join order", async () => {
    const rows = [
      {
        id: userAId,
        username: "alice",
        fullName: "Alice",
        avatarUrl: null,
        role: "ADMIN",
        joinedAt: new Date("2026-10-19T00:00:00Z"),
      },
    ];
    const orderByMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue(rows);
    const whereMock = vi.fn<(condition: SQL) => unknown>(() => ({ orderBy: orderByMock }));
    const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>(() => ({
      where: whereMock,
    }));
    const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
    const selectMock = vi.fn(() => ({ from: fromMock }));
    const db = { select: selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.listMembers(convRow.id)).resolves.toEqual(rows);

    expect(selectMock).toHaveBeenCalledWith({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      role: conversationParticipants.role,
      joinedAt: conversationParticipants.joinedAt,
    });
    expect(innerJoinMock).toHaveBeenCalledWith(users, expect.anything());
    const join = render(innerJoinMock.mock.calls[0][1]);
    expect(join.sql).toContain('"users"."id" = "conversation_participants"."user_id"');
    const where = render(whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id]);
    expect(orderByMock).toHaveBeenCalledTimes(1);
    const order = orderByMock.mock.calls[0].map((arg) => render(arg as SQL).sql);
    expect(order[0]).toContain('"conversation_participants"."joined_at"');
    expect(order[1]).toContain('"users"."id"');
  });
});

describe("ConversationPgRepository.getGroupMembership", () => {
  it("returns the role and history boundary for an active member", async () => {
    const { db, dbSelect } = makeTxDb();
    const row = { role: "ADMIN", historyBoundaryMessageId: msgId };
    dbSelect.limitMock.mockResolvedValueOnce([row]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getGroupMembership(convRow.id, userAId)).resolves.toEqual(row);
    expect(dbSelect.selectMock).toHaveBeenCalledWith({
      role: conversationParticipants.role,
      historyBoundaryMessageId: conversationParticipants.historyBoundaryMessageId,
    });
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id, userAId]);
  });

  it("returns null when the member has left the group", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getGroupMembership(convRow.id, userAId)).resolves.toBeNull();
  });
});

describe("ConversationPgRepository.canAccessMessage", () => {
  function makeCanAccessDb(outerRows: unknown[]) {
    const subWhereMock = vi.fn<(condition: SQL) => SQL>((condition) => sql`(${condition})`);
    const subFromMock = vi.fn(() => ({ where: subWhereMock }));
    const limitMock = vi.fn<(limit: number) => Promise<unknown[]>>().mockResolvedValue(outerRows);
    const outerWhereMock = vi.fn<(condition: SQL) => unknown>(() => ({ limit: limitMock }));
    const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>(() => ({
      where: outerWhereMock,
    }));
    const outerFromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({ from: outerFromMock })
      .mockReturnValueOnce({ from: subFromMock });
    const db = { select: selectMock } as unknown as DrizzleDb;
    return { db, selectMock, outerWhereMock, subWhereMock, innerJoinMock, limitMock };
  }

  it("returns true when an active participant can see the message", async () => {
    const { db, outerWhereMock, subWhereMock, innerJoinMock, limitMock } = makeCanAccessDb([
      { id: msgId },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.canAccessMessage(convRow.id, userAId, msgId)).resolves.toBe(true);

    expect(limitMock).toHaveBeenCalledWith(1);
    const join = render(innerJoinMock.mock.calls[0][1]);
    expect(join.sql).toContain(
      '"conversation_participants"."conversation_id" = "messages"."conversation_id"',
    );
    expect(join.sql).toContain('"conversation_participants"."left_at" is null');
    expect(join.params).toEqual([userAId]);

    const sub = render(subWhereMock.mock.calls[0][0]);
    expect(sub.sql).toContain('"message_hidden_for_users"."message_id" =');
    expect(sub.sql).toContain('"message_hidden_for_users"."user_id" =');
    expect(sub.params).toEqual([userAId]);

    const where = render(outerWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"messages"."id" =');
    expect(where.sql).toContain('"messages"."conversation_id" =');
    expect(where.sql).toContain("not exists");
    expect(where.sql).toContain("ROW(");
    expect(where.params).toEqual([msgId, convRow.id, userAId]);
  });

  it("returns false when the participant cannot see the message", async () => {
    const { db } = makeCanAccessDb([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.canAccessMessage(convRow.id, userAId, msgId)).resolves.toBe(false);
  });
});

describe("ConversationPgRepository.getMessageRecipientUserIds", () => {
  function makeRecipientsDb(rows: unknown[]) {
    const subWhereMock = vi.fn<(condition: SQL) => SQL>((condition) => sql`(${condition})`);
    const subFromMock = vi.fn(() => ({ where: subWhereMock }));
    const whereMock = vi.fn<(condition: SQL) => Promise<unknown[]>>().mockResolvedValue(rows);
    const innerJoinMock = vi.fn<(table: unknown, condition: SQL) => unknown>(() => ({
      where: whereMock,
    }));
    const outerFromMock = vi.fn(() => ({ innerJoin: innerJoinMock }));
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({ from: subFromMock })
      .mockReturnValueOnce({ from: outerFromMock });
    const db = { select: selectMock } as unknown as DrizzleDb;
    return { db, selectMock, whereMock, subWhereMock, innerJoinMock };
  }

  it("returns the active participants who can see the message", async () => {
    const { db, whereMock, subWhereMock, innerJoinMock } = makeRecipientsDb([
      { userId: userAId },
      { userId: userBId },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getMessageRecipientUserIds(convRow.id, msgId)).resolves.toEqual([
      userAId,
      userBId,
    ]);

    expect(innerJoinMock).toHaveBeenCalledWith(messages, expect.anything());
    const join = render(innerJoinMock.mock.calls[0][1]);
    expect(join.sql).toContain('"messages"."id" =');
    expect(join.sql).toContain('"messages"."conversation_id" =');
    expect(join.params).toEqual([msgId, convRow.id]);

    const sub = render(subWhereMock.mock.calls[0][0]);
    expect(sub.sql).toContain('"message_hidden_for_users"."message_id" =');
    expect(sub.params).toEqual([]);

    const where = render(whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."conversation_id" =');
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.sql).toContain("boundary_message");
    expect(where.sql).toContain("not exists");
    expect(where.params).toEqual([convRow.id, convRow.id]);
  });

  it("returns an empty list when no participant can see the message", async () => {
    const { db } = makeRecipientsDb([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getMessageRecipientUserIds(convRow.id, msgId)).resolves.toEqual([]);
  });
});

describe("ConversationPgRepository.findDirectByParticipants", () => {
  function makeDirectDb(row?: Record<string, unknown>) {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce(row ? [row] : []);
    return { db, dbSelect };
  }

  it("returns the direct conversation row for the pair", async () => {
    const row = { ...convRow, partner: partnerRow };
    const { db, dbSelect } = makeDirectDb(row);
    const repo = new ConversationPgRepository(db);

    await expect(repo.findDirectByParticipants(userAId, userBId)).resolves.toEqual(row);

    expect(dbSelect.innerJoinMock).toHaveBeenNthCalledWith(
      1,
      conversationParticipants,
      expect.anything(),
    );
    expect(dbSelect.innerJoinMock).toHaveBeenNthCalledWith(2, users, expect.anything());
    expect(dbSelect.leftJoinMock).toHaveBeenCalledTimes(2);
    expect(dbSelect.leftJoinMock).toHaveBeenNthCalledWith(1, messages, expect.anything());
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversations"."direct_key" =');
    expect(where.sql).toContain('"conversations"."deleted_at" is null');
    expect(where.params).toEqual([directKey]);
  });

  it("uses the same canonical key for either argument order", async () => {
    const { db, dbSelect } = makeDirectDb({ ...convRow, partner: partnerRow });
    const repo = new ConversationPgRepository(db);

    await repo.findDirectByParticipants(userBId, userAId);

    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.params).toEqual([directKey]);
  });

  it("returns null when the pair has no active conversation", async () => {
    const { db } = makeDirectDb();
    const repo = new ConversationPgRepository(db);

    await expect(repo.findDirectByParticipants(userAId, userBId)).resolves.toBeNull();
  });
});

describe("ConversationPgRepository.findUserConversations", () => {
  const inboxDirectRow = {
    id: newConvRow.id,
    kind: "DIRECT" as const,
    directKey,
    title: null,
    avatarUrl: null,
    myRole: "MEMBER" as const,
    memberCount: 2,
    lastMessagePreview: null,
    lastMessageSenderId: null,
    lastMessageSender: null,
    lastMessageAt: null,
    createdAt: newConvRow.createdAt,
    lastReadMessageId: null,
    unreadRevision: "0",
    joinGeneration: "1",
  };
  const inboxGroupRow = {
    ...inboxDirectRow,
    id: convRow.id,
    kind: "GROUP" as const,
    directKey: null,
    title: groupTitle,
    myRole: "ADMIN" as const,
  };

  function makeInboxDb() {
    const chain = makeTxSelect();
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    return { db, chain };
  }

  it("returns the page with partners resolved for direct conversations", async () => {
    const { db, chain } = makeInboxDb();
    chain.limitMock
      .mockResolvedValueOnce([inboxDirectRow, inboxGroupRow])
      .mockResolvedValueOnce([{ conversationId: inboxDirectRow.id, user: partnerRow }]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findUserConversations(userAId, 10);

    expect(result).toEqual({
      items: [
        { ...inboxDirectRow, partner: partnerRow },
        { ...inboxGroupRow, partner: undefined },
      ],
      hasMore: false,
    });
    expect(chain.limitMock).toHaveBeenNthCalledWith(1, 11);
    const where = render(chain.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."user_id" =');
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.sql).toContain('"conversations"."deleted_at" is null');
    expect(where.params).toEqual([userAId]);
    expect(chain.orderByMock).toHaveBeenCalledTimes(1);
    const order = chain.orderByMock.mock.calls[0].map((arg) => render(arg as SQL).sql);
    expect(order[0]).toContain("COALESCE(");
    expect(order[0]).toContain('"conversations"."created_at"');
    expect(order[1]).toContain('"conversations"."id"');
    const partnerWhere = render(chain.whereMock.mock.calls[1][0]);
    expect(partnerWhere.sql).toContain('"conversation_participants"."conversation_id" in');
    expect(partnerWhere.sql).toContain('"conversation_participants"."user_id" <>');
    expect(partnerWhere.sql).toContain('"conversation_participants"."left_at" is null');
    expect(partnerWhere.params).toEqual([inboxDirectRow.id, userAId]);
  });

  it("trims the page to the limit and exposes the next cursor", async () => {
    const { db, chain } = makeInboxDb();
    const secondRow = { ...inboxDirectRow, id: convRow.id };
    chain.limitMock
      .mockResolvedValueOnce([inboxDirectRow, secondRow])
      .mockResolvedValueOnce([{ conversationId: inboxDirectRow.id, user: partnerRow }]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findUserConversations(userAId, 1);

    expect(result).toEqual({
      items: [{ ...inboxDirectRow, partner: partnerRow }],
      nextCursor: inboxDirectRow.id,
      hasMore: true,
    });
  });

  it("returns an empty page without a partner lookup when there are no conversations", async () => {
    const { db, chain } = makeInboxDb();
    chain.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.findUserConversations(userAId, 10)).resolves.toEqual({
      items: [],
      hasMore: false,
    });
    expect(chain.selectMock).toHaveBeenCalledTimes(1);
  });

  it("skips the partner lookup when the page has no direct conversations", async () => {
    const { db, chain } = makeInboxDb();
    chain.limitMock.mockResolvedValueOnce([inboxGroupRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findUserConversations(userAId, 10);

    expect(result).toEqual({ items: [inboxGroupRow], hasMore: false });
    expect(chain.selectMock).toHaveBeenCalledTimes(1);
  });

  it("starts after the cursor conversation when a cursor is provided", async () => {
    const { db, chain } = makeInboxDb();
    const cursorAt = new Date("2026-10-19T07:00:00Z");
    chain.limitMock
      .mockResolvedValueOnce([{ ...groupFindCursorRow, lastMessageAt: cursorAt }])
      .mockResolvedValueOnce([inboxDirectRow])
      .mockResolvedValueOnce([{ conversationId: inboxDirectRow.id, user: partnerRow }]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findUserConversations(userAId, 10, convRow.id);

    expect(result.items).toEqual([{ ...inboxDirectRow, partner: partnerRow }]);
    const where = render(chain.whereMock.mock.calls[1][0]);
    expect(where.sql).toContain("COALESCE(");
    expect(where.sql).toContain('"conversations"."id" <');
    expect(where.params[0]).toBe(userAId);
    expect(where.params.filter((param) => param === cursorAt)).toHaveLength(2);
    expect(where.params.slice(-2)).toEqual([cursorAt, convRow.id]);
  });

  it("returns an empty page when the cursor conversation is not visible", async () => {
    const { db, chain } = makeInboxDb();
    chain.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.findUserConversations(userAId, 10, convRow.id)).resolves.toEqual({
      items: [],
      hasMore: false,
    });
    expect(chain.selectMock).toHaveBeenCalledTimes(1);
    expect(chain.whereMock).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationPgRepository.findById mapping", () => {
  it("maps the sender and partner join columns into nested objects", async () => {
    const { db, dbSelect } = makeDb();
    const row = {
      ...groupFindCursorRow,
      kind: "DIRECT" as const,
      directKey,
      partnerId: userBId,
      partnerUsername: "bob",
      partnerFullName: "Bob Nguyen",
      partnerAvatarUrl: null,
      lastMessageSenderUserId: userAId,
      lastMessageSenderUsername: "alice",
      lastMessageSenderFullName: "Alice",
      lastMessageSenderAvatarUrl: null,
    };
    dbSelect.limitMock.mockResolvedValueOnce([row]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findById(convRow.id, userAId);

    expect(result).toMatchObject({
      id: convRow.id,
      kind: "DIRECT",
      directKey,
      title: groupTitle,
      avatarUrl: null,
      myRole: "ADMIN",
      memberCount: 2,
      historyBoundaryMessageId: null,
      historyBoundaryWasEmpty: true,
      joinGeneration: "1",
      lastReadAt: null,
      createdAt: convRow.createdAt,
      lastReadMessageId: null,
      unreadRevision: "0",
      partner: { id: userBId, username: "bob", fullName: "Bob Nguyen", avatarUrl: null },
      lastMessageSender: {
        id: userAId,
        username: "alice",
        fullName: "Alice",
        avatarUrl: null,
      },
    });
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversations"."deleted_at" is null');
    expect(where.params).toEqual([convRow.id]);
  });

  it("omits the partner and sender objects when their join columns are null", async () => {
    const { db, dbSelect } = makeDb();
    dbSelect.limitMock.mockResolvedValueOnce([groupFindCursorRow]);
    const repo = new ConversationPgRepository(db);

    const result = await repo.findById(convRow.id, userAId);

    expect(result).toBeDefined();
    expect(result?.partner).toBeUndefined();
    expect(result?.lastMessageSender).toBeUndefined();
  });
});

describe("ConversationPgRepository.existsById", () => {
  it("confirms an active conversation by id", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ id: convRow.id }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.existsById(convRow.id)).resolves.toBe(true);
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversations"."deleted_at" is null');
    expect(where.params).toEqual([convRow.id]);
  });

  it("returns false for a missing or soft-deleted conversation", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.existsById(convRow.id)).resolves.toBe(false);
  });
});

describe("ConversationPgRepository.isParticipant", () => {
  it("confirms an active membership", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ conversationId: convRow.id }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.isParticipant(convRow.id, userAId)).resolves.toBe(true);
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id, userAId]);
  });

  it("returns false when the user has left the conversation", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.isParticipant(convRow.id, userAId)).resolves.toBe(false);
  });
});

describe("ConversationPgRepository.getParticipantUserIds", () => {
  it("returns the active participant ids", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([{ userId: userAId }, { userId: userBId }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getParticipantUserIds(convRow.id)).resolves.toEqual([userAId, userBId]);
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id]);
  });

  it("returns an empty list when nobody is active", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getParticipantUserIds(convRow.id)).resolves.toEqual([]);
  });
});

describe("ConversationPgRepository.getActiveConversationIds", () => {
  it("returns the conversation ids of active memberships", async () => {
    const { db, dbSelect } = makeTxDb();
    dbSelect.limitMock.mockResolvedValueOnce([
      { conversationId: convRow.id },
      { conversationId: newConvRow.id },
    ]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.getActiveConversationIds(userAId)).resolves.toEqual([
      convRow.id,
      newConvRow.id,
    ]);
    const where = render(dbSelect.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([userAId]);
  });
});

describe("ConversationPgRepository.updateLastRead guards", () => {
  const t0 = new Date("2026-10-19T00:00:00Z");
  const t1 = new Date("2026-10-19T01:00:00Z");
  const t2 = new Date("2026-10-19T02:00:00Z");
  const t3 = new Date("2026-10-19T03:00:00Z");
  const boundaryId = "0193a2b1-0000-7000-8000-0000000000b1";
  const lastReadId = "0193a2b1-0000-7000-8000-0000000000b2";

  it("throws NOT_PARTICIPANT when the user has left the conversation", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock.mockResolvedValueOnce([{}]).mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });
    expect(updateMock).not.toHaveBeenCalled();
    const participantWhere = render(txSelect.whereMock.mock.calls[1][0]);
    expect(participantWhere.sql).toContain('"conversation_participants"."left_at" is null');
    expect(participantWhere.params).toEqual([convRow.id, userAId]);
  });

  it("rejects when the target message is missing or hidden", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: null,
          historyBoundaryMessageId: null,
          historyBoundaryWasEmpty: true,
          joinedAt: t0,
        },
      ])
      .mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects when the history boundary message can no longer be read", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: null,
          historyBoundaryMessageId: boundaryId,
          historyBoundaryWasEmpty: false,
          joinedAt: t0,
        },
      ])
      .mockResolvedValueOnce([{ id: msgId, createdAt: t3 }])
      .mockResolvedValueOnce([]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updateMock).not.toHaveBeenCalled();
    const boundaryWhere = render(txSelect.whereMock.mock.calls[4][0]);
    expect(boundaryWhere.sql).toContain('"messages"."conversation_id" =');
    expect(boundaryWhere.params).toEqual([boundaryId, convRow.id]);
  });

  it("rejects when the message is not newer than the history boundary", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: null,
          historyBoundaryMessageId: boundaryId,
          historyBoundaryWasEmpty: false,
          joinedAt: t0,
        },
      ])
      .mockResolvedValueOnce([{ id: "0193a2b1-0000-7000-8000-000000000041", createdAt: t1 }])
      .mockResolvedValueOnce([{ id: "0193a2b1-0000-7000-8000-000000000042", createdAt: t1 }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects when the message predates the join of a member without boundary", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: null,
          historyBoundaryMessageId: null,
          historyBoundaryWasEmpty: false,
          joinedAt: t2,
        },
      ])
      .mockResolvedValueOnce([{ id: msgId, createdAt: t1 }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("keeps the existing marker when the message is older than the last read", async () => {
    const { db, txSelect, updateMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: lastReadId,
          historyBoundaryMessageId: null,
          historyBoundaryWasEmpty: true,
          joinedAt: t0,
        },
      ])
      .mockResolvedValueOnce([{ id: "0193a2b1-0000-7000-8000-000000000041", createdAt: t1 }])
      .mockResolvedValueOnce([{ id: lastReadId, createdAt: t2 }]);
    const repo = new ConversationPgRepository(db);

    await expect(repo.updateLastRead(convRow.id, userAId, msgId)).resolves.toBeUndefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("advances the marker past an older last read while respecting the boundary", async () => {
    const { db, txSelect, updateMock, setMock, updateWhereMock } = makeTxDb();
    txSelect.limitMock
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([
        {
          lastReadMessageId: lastReadId,
          historyBoundaryMessageId: boundaryId,
          historyBoundaryWasEmpty: false,
          joinedAt: t0,
        },
      ])
      .mockResolvedValueOnce([{ id: msgId, createdAt: t3 }])
      .mockResolvedValueOnce([{ id: boundaryId, createdAt: t1 }])
      .mockResolvedValueOnce([{ id: lastReadId, createdAt: t2 }]);
    const repo = new ConversationPgRepository(db);

    await repo.updateLastRead(convRow.id, userAId, msgId);

    expect(updateMock).toHaveBeenCalledWith(conversationParticipants);
    expect(setMock).toHaveBeenCalledWith({
      lastReadMessageId: msgId,
      lastReadAt: expect.anything(),
    });
    const values = setMock.mock.calls[0][0] as { lastReadAt: SQL };
    expect(render(values.lastReadAt).sql).toBe("now()");
    const where = render(updateWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"conversation_participants"."left_at" is null');
    expect(where.params).toEqual([convRow.id, userAId]);

    const messageWhere = render(txSelect.whereMock.mock.calls[3][0]);
    expect(messageWhere.sql).toContain('"messages"."id" =');
    expect(messageWhere.sql).toContain('"messages"."conversation_id" =');
    expect(messageWhere.sql).toContain("not exists");
    expect(messageWhere.params.slice(0, 2)).toEqual([msgId, convRow.id]);

    const hiddenSubquery = render(txSelect.whereMock.mock.calls[2][0]);
    expect(hiddenSubquery.sql).toContain('"message_hidden_for_users"."message_id" =');
    expect(hiddenSubquery.sql).toContain('"message_hidden_for_users"."user_id" =');
    expect(hiddenSubquery.params).toEqual([userAId]);

    const lastReadWhere = render(txSelect.whereMock.mock.calls[5][0]);
    expect(lastReadWhere.params).toEqual([lastReadId, convRow.id]);
  });
});

describe("ConversationPgRepository.findPendingAvatarCleanupJobs", () => {
  it("returns pending jobs within the retry budget", async () => {
    const chain = makeTxSelect();
    const rows = [
      {
        id: "0193a2b1-0000-7000-8000-0000000000j1",
        conversationId: convRow.id,
        objectKey: `group-avatars/${convRow.id}/x.png`,
        attempts: 1,
      },
    ];
    chain.limitMock.mockResolvedValueOnce(rows);
    const db = { select: chain.selectMock } as unknown as DrizzleDb;
    const repo = new ConversationPgRepository(db);

    await expect(repo.findPendingAvatarCleanupJobs(7)).resolves.toEqual(rows);

    expect(chain.fromMock).toHaveBeenCalledWith(avatarCleanupJobs);
    expect(chain.limitMock).toHaveBeenCalledWith(7);
    const where = render(chain.whereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"avatar_cleanup_jobs"."status" =');
    expect(where.sql).toContain('"avatar_cleanup_jobs"."attempts" <');
    expect(where.params).toEqual(["PENDING", 5]);
  });
});

describe("ConversationPgRepository.completeAvatarCleanupJobs", () => {
  const jobIds = ["0193a2b1-0000-7000-8000-0000000000j1", "0193a2b1-0000-7000-8000-0000000000j2"];

  function makeCleanupDb(result: unknown) {
    const { db, deleteMock, deleteWhereMock } = makeTxDb();
    deleteWhereMock.mockResolvedValueOnce(result);
    return { db, deleteMock, deleteWhereMock };
  }

  it("deletes the listed jobs and returns the deleted row count", async () => {
    const { db, deleteMock, deleteWhereMock } = makeCleanupDb({ rowCount: 2 });
    const repo = new ConversationPgRepository(db);

    await expect(repo.completeAvatarCleanupJobs(jobIds)).resolves.toBe(2);
    expect(deleteMock).toHaveBeenCalledWith(avatarCleanupJobs);
    const where = render(deleteWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"avatar_cleanup_jobs"."id" in');
    expect(where.params).toEqual(jobIds);
  });

  it("falls back to the requested count when the driver reports no rowCount", async () => {
    const { db } = makeCleanupDb({});
    const repo = new ConversationPgRepository(db);

    await expect(repo.completeAvatarCleanupJobs(jobIds)).resolves.toBe(2);
  });

  it("does nothing for an empty id list", async () => {
    const { db, deleteMock } = makeCleanupDb({ rowCount: 0 });
    const repo = new ConversationPgRepository(db);

    await expect(repo.completeAvatarCleanupJobs([])).resolves.toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("ConversationPgRepository.failAvatarCleanupJob", () => {
  const jobId = "0193a2b1-0000-7000-8000-0000000000j1";

  it("keeps the job pending with the error recorded before the retry budget runs out", async () => {
    const { db, updateMock, setMock, updateWhereMock } = makeTxDb();
    const repo = new ConversationPgRepository(db);

    await repo.failAvatarCleanupJob(jobId, 1, "storage down");

    expect(updateMock).toHaveBeenCalledWith(avatarCleanupJobs);
    const values = setMock.mock.calls[0][0] as {
      attempts: number;
      status: string;
      lastError: string;
      updatedAt: SQL;
    };
    expect(values.attempts).toBe(2);
    expect(values.status).toBe("PENDING");
    expect(values.lastError).toBe("storage down");
    expect(render(values.updatedAt).sql).toBe("now()");
    const where = render(updateWhereMock.mock.calls[0][0]);
    expect(where.sql).toContain('"avatar_cleanup_jobs"."id" =');
    expect(where.params).toEqual([jobId]);
  });

  it("marks the job failed on the final attempt and truncates the error", async () => {
    const { db, setMock } = makeTxDb();
    const repo = new ConversationPgRepository(db);

    await repo.failAvatarCleanupJob(jobId, 4, "x".repeat(520));

    const values = setMock.mock.calls[0][0] as {
      attempts: number;
      status: string;
      lastError: string;
    };
    expect(values.attempts).toBe(5);
    expect(values.status).toBe("FAILED");
    expect(values.lastError).toHaveLength(500);
  });
});
