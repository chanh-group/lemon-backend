import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { conversationParticipants } from "../../../../src/domain/conversation/schema.js";
import { FriendPgRepository } from "../../../../src/domain/friend/pg.js";
import { friendships } from "../../../../src/domain/friend/schema.js";
import { SystemError } from "../../../../src/utils/errors/system.js";

const userId = "0193a2b1-0000-7000-8000-000000000001";
const friendId = "0193a2b1-0000-7000-8000-000000000002";
const otherFriendId = "0193a2b1-0000-7000-8000-000000000003";

const day1 = new Date("2026-01-31T00:00:00.000Z");
const day2 = new Date("2026-02-01T00:00:00.000Z");
const day3 = new Date("2026-02-02T00:00:00.000Z");

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);
const makeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

function makeJoinLimitChain() {
  // select().from().innerJoin().where().orderBy().limit() -> resolves rows
  const limit = vi.fn().mockResolvedValue([]);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  return { select, from, innerJoin, where, orderBy, limit };
}

function makeAcceptDb() {
  const updateReturning = vi.fn().mockResolvedValue([]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn(() => ({ set }));

  const limit = vi.fn().mockResolvedValue([]);
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  const insertReturning = vi.fn().mockResolvedValue([]);
  const onConflictDoNothing = vi.fn(() => ({ returning: insertReturning }));
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn().mockReturnValue({ onConflictDoNothing, onConflictDoUpdate });
  const insert = vi.fn(() => ({ values }));

  const tx = { select, insert, update };
  const transaction = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const db = { transaction } as unknown as DrizzleDb;
  return {
    db,
    transaction,
    update,
    set,
    updateWhere,
    updateReturning,
    select,
    from,
    selectWhere,
    limit,
    insert,
    values,
    insertReturning,
    onConflictDoNothing,
    onConflictDoUpdate,
  };
}

describe("FriendPgRepository.getAcceptedFriendIds", () => {
  it("returns all accepted friends in either pair ordering", async () => {
    const where = vi.fn().mockResolvedValue([
      { userLow: userId, userHigh: friendId },
      { userLow: otherFriendId, userHigh: userId },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.getAcceptedFriendIds(userId)).resolves.toEqual([friendId, otherFriendId]);

    const condition = where.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.sql).toContain('"friendships"."user_low" =');
    expect(query.sql).toContain('"friendships"."user_high" =');
    expect(query.params).toEqual(["ACCEPTED", userId, userId]);
  });

  it("returns an empty list when the user has no accepted friends", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.getAcceptedFriendIds(userId)).resolves.toEqual([]);
    expect(where).toHaveBeenCalledOnce();
  });
});

describe("FriendPgRepository.deleteOutgoingRequest", () => {
  it("deletes the pending outgoing request and returns id and addresseeId", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "req-1", addresseeId: friendId }]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteOutgoingRequest("req-1", userId)).resolves.toEqual({
      id: "req-1",
      addresseeId: friendId,
    });

    const condition = where.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"friendships"."id" =');
    expect(query.sql).toContain('"friendships"."requester_id" =');
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.params).toEqual(["req-1", userId, "PENDING"]);
  });

  it("returns null when no matching pending outgoing request exists", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteOutgoingRequest("missing", userId)).resolves.toBeNull();
  });
});

describe("FriendPgRepository.deleteIncomingRequest", () => {
  it("deletes the pending incoming request and returns id and requesterId", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "req-1", requesterId: friendId }]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteIncomingRequest("req-1", userId)).resolves.toEqual({
      id: "req-1",
      requesterId: friendId,
    });

    const condition = where.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"friendships"."id" =');
    expect(query.sql).toContain('"friendships"."addressee_id" =');
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.params).toEqual(["req-1", userId, "PENDING"]);
  });

  it("returns null when no matching pending incoming request exists", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteIncomingRequest("missing", userId)).resolves.toBeNull();
  });
});

describe("FriendPgRepository.findByPair", () => {
  it("returns the friendship row for the pair in canonical order", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "fri-1", status: "ACCEPTED" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.findByPair(friendId, userId)).resolves.toEqual({
      id: "fri-1",
      status: "ACCEPTED",
    });

    expect(limit).toHaveBeenCalledWith(1);
    const condition = where.mock.calls[0][0] as SQL;
    const query = render(condition);
    expect(query.sql).toContain('"friendships"."user_low" =');
    expect(query.sql).toContain('"friendships"."user_high" =');
    expect(query.params).toEqual([userId, friendId]);
  });

  it("returns null when the pair has no friendship row", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.findByPair(userId, friendId)).resolves.toBeNull();
    expect(limit).toHaveBeenCalledWith(1);
    expect(select).toHaveBeenCalledOnce();
  });
});

describe("FriendPgRepository.createRequest", () => {
  it("inserts a pending request with canonical pair columns", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "fri-1", status: "PENDING" }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn(() => ({ values }));
    const repo = new FriendPgRepository({ insert } as unknown as DrizzleDb);

    await expect(repo.createRequest(friendId, userId)).resolves.toEqual({
      friendship: { id: "fri-1", status: "PENDING" },
      created: true,
    });

    expect(values.mock.calls[0][0]).toEqual({
      requesterId: friendId,
      addresseeId: userId,
      userLow: userId,
      userHigh: friendId,
      status: "PENDING",
    });
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: [friendships.userLow, friendships.userHigh],
    });
    expect(returning).toHaveBeenCalledOnce();
  });

  it("returns the existing friendship when the pair already exists", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn(() => ({ values }));
    const existing = { id: "fri-1", status: "ACCEPTED" };
    const limit = vi.fn().mockResolvedValue([existing]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ insert, select } as unknown as DrizzleDb);

    await expect(repo.createRequest(userId, friendId)).resolves.toEqual({
      friendship: existing,
      created: false,
    });

    expect(select).toHaveBeenCalledOnce();
    const condition = where.mock.calls[0][0] as SQL;
    const query = render(condition);
    expect(query.sql).toContain('"friendships"."user_low" =');
    expect(query.sql).toContain('"friendships"."user_high" =');
    expect(query.params).toEqual([userId, friendId]);
  });

  it("throws a system error when the conflicting row is missing", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ insert, select } as unknown as DrizzleDb);

    const pending = repo.createRequest(userId, friendId);
    await expect(pending).rejects.toBeInstanceOf(SystemError);
    await expect(pending).rejects.toThrow("Friend request conflict row was not found");
  });
});

describe("FriendPgRepository.listFriendsPage", () => {
  it("merges outgoing and incoming friends and maps items to public profiles", async () => {
    const { select, innerJoin, where, orderBy, limit } = makeJoinLimitChain();
    const outgoing = {
      id: friendId,
      createdAt: day3,
      friendshipId: "fri-a",
      name: "Friend A",
      username: "friend_a",
      avatarUrl: "a.png",
    };
    const incoming = {
      id: otherFriendId,
      createdAt: day2,
      friendshipId: "fri-b",
      name: "Friend B",
      username: "friend_b",
      avatarUrl: null,
    };
    limit.mockResolvedValueOnce([outgoing]).mockResolvedValueOnce([incoming]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const page = await repo.listFriendsPage(userId, undefined, 10);

    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toEqual([
      { id: friendId, name: "Friend A", username: "friend_a", avatarUrl: "a.png" },
      { id: otherFriendId, name: "Friend B", username: "friend_b", avatarUrl: null },
    ]);
    expect(innerJoin).toHaveBeenCalledTimes(2);
    expect(orderBy).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(11);
    const outgoingFilter = render(where.mock.calls[0][0]);
    expect(outgoingFilter.sql).toContain('"friendships"."requester_id" =');
    expect(outgoingFilter.sql).toContain('"friendships"."status" =');
    expect(outgoingFilter.sql).toContain('"users"."deleted_at" is null');
    expect(outgoingFilter.params).toEqual([userId, "ACCEPTED"]);
    const incomingFilter = render(where.mock.calls[1][0]);
    expect(incomingFilter.sql).toContain('"friendships"."addressee_id" =');
    expect(incomingFilter.params).toEqual([userId, "ACCEPTED"]);
  });

  it("trims oversized merged pages, breaks createdAt ties by friendship id and encodes the next cursor", async () => {
    const { select, limit } = makeJoinLimitChain();
    limit
      .mockResolvedValueOnce([
        {
          id: friendId,
          createdAt: day3,
          friendshipId: "fri-a",
          name: "Friend A",
          username: "friend_a",
          avatarUrl: "a.png",
        },
        {
          id: friendId,
          createdAt: day2,
          friendshipId: "fri-b",
          name: "Friend B",
          username: "friend_b",
          avatarUrl: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: otherFriendId,
          createdAt: day3,
          friendshipId: "fri-c",
          name: "Friend C",
          username: "friend_c",
          avatarUrl: null,
        },
        {
          id: otherFriendId,
          createdAt: day1,
          friendshipId: "fri-d",
          name: "Friend D",
          username: "friend_d",
          avatarUrl: null,
        },
      ]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const page = await repo.listFriendsPage(userId, undefined, 1);

    expect(page.hasMore).toBe(true);
    expect(page.items).toEqual([
      { id: otherFriendId, name: "Friend C", username: "friend_c", avatarUrl: null },
    ]);
    expect(page.nextCursor).toBe(makeCursor(day3, "fri-c"));
  });

  it("applies the decoded cursor to both friend queries", async () => {
    const { select, where, limit } = makeJoinLimitChain();
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const page = await repo.listFriendsPage(userId, makeCursor(day2, "fri-x"), 10);

    expect(page.items).toEqual([]);
    expect(where).toHaveBeenCalledTimes(2);
    for (const [condition] of where.mock.calls) {
      const query = render(condition as SQL);
      expect(query.sql).toContain('"friendships"."created_at" <');
      expect(query.sql).toContain('"friendships"."created_at" =');
      expect(query.sql).toContain('"friendships"."id" <');
      expect(query.params).toEqual([
        userId,
        "ACCEPTED",
        day2.toISOString(),
        day2.toISOString(),
        "fri-x",
      ]);
    }
  });

  it("ignores a corrupt cursor and queries the first page", async () => {
    const { select, where, limit } = makeJoinLimitChain();
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const page = await repo.listFriendsPage(userId, "!!!!", 10);

    expect(page).toEqual({ items: [], hasMore: false });
    expect(where).toHaveBeenCalledTimes(2);
    for (const [condition] of where.mock.calls) {
      expect((render(condition as SQL)).params).toEqual([userId, "ACCEPTED"]);
    }
  });
});

describe("FriendPgRepository.findAcceptedFriendIds", () => {
  it("returns an empty set without querying when there are no candidates", async () => {
    const where = vi.fn();
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.findAcceptedFriendIds(userId, [])).resolves.toEqual(new Set());
    expect(select).not.toHaveBeenCalled();
  });

  it("maps both pair orderings of accepted rows onto a set of candidate ids", async () => {
    const where = vi.fn().mockResolvedValue([
      { userLow: userId, userHigh: friendId },
      { userLow: otherFriendId, userHigh: userId },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.findAcceptedFriendIds(userId, [friendId, otherFriendId])).resolves.toEqual(
      new Set([friendId, otherFriendId]),
    );

    const condition = where.mock.calls[0][0] as SQL;
    const query = render(condition);
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.sql).toContain('"friendships"."user_high" in');
    expect(query.sql).toContain('"friendships"."user_low" in');
    expect(query.params).toEqual([
      "ACCEPTED",
      userId,
      friendId,
      otherFriendId,
      userId,
      friendId,
      otherFriendId,
    ]);
  });
});

describe("FriendPgRepository.listRequestsPage", () => {
  it("returns incoming and outgoing pages tagged with their direction", async () => {
    const { select, innerJoin, where, limit } = makeJoinLimitChain();
    const inRow = {
      id: "fri-1",
      createdAt: day3,
      user: { id: friendId, name: "Friend A", username: "friend_a", avatarUrl: "a.png" },
    };
    const outRow = {
      id: "fri-2",
      createdAt: day2,
      user: { id: otherFriendId, name: "Friend B", username: "friend_b", avatarUrl: null },
    };
    limit.mockResolvedValueOnce([inRow]).mockResolvedValueOnce([outRow]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const result = await repo.listRequestsPage(userId, undefined, undefined, 10);

    expect(result.incoming.items).toEqual([{ ...inRow, direction: "incoming" }]);
    expect(result.outgoing.items).toEqual([{ ...outRow, direction: "outgoing" }]);
    expect(result.incoming.hasMore).toBe(false);
    expect(result.outgoing.hasMore).toBe(false);
    expect(innerJoin).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(11);
    const incomingFilter = render(where.mock.calls[0][0]);
    expect(incomingFilter.sql).toContain('"friendships"."addressee_id" =');
    expect(incomingFilter.sql).toContain('"friendships"."status" =');
    expect(incomingFilter.sql).toContain('"users"."deleted_at" is null');
    expect(incomingFilter.params).toEqual([userId, "PENDING"]);
    const outgoingFilter = render(where.mock.calls[1][0]);
    expect(outgoingFilter.sql).toContain('"friendships"."requester_id" =');
    expect(outgoingFilter.params).toEqual([userId, "PENDING"]);
  });

  it("applies each decoded cursor to its own request query", async () => {
    const { select, where, limit } = makeJoinLimitChain();
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const result = await repo.listRequestsPage(
      userId,
      makeCursor(day3, "fri-1"),
      makeCursor(day2, "fri-2"),
      10,
    );

    expect(result.incoming.items).toEqual([]);
    expect(result.outgoing.items).toEqual([]);
    expect(render(where.mock.calls[0][0]).params).toEqual([
      userId,
      "PENDING",
      day3.toISOString(),
      day3.toISOString(),
      "fri-1",
    ]);
    expect(render(where.mock.calls[1][0]).params).toEqual([
      userId,
      "PENDING",
      day2.toISOString(),
      day2.toISOString(),
      "fri-2",
    ]);
  });

  it("splits oversized pages and encodes a next cursor per direction", async () => {
    const { select, limit } = makeJoinLimitChain();
    const inA = {
      id: "fri-1",
      createdAt: day3,
      user: { id: friendId, name: "Friend A", username: "friend_a", avatarUrl: "a.png" },
    };
    const inB = {
      id: "fri-2",
      createdAt: day2,
      user: { id: friendId, name: "Friend B", username: "friend_b", avatarUrl: null },
    };
    const outA = {
      id: "fri-3",
      createdAt: day1,
      user: { id: otherFriendId, name: "Friend C", username: "friend_c", avatarUrl: null },
    };
    limit.mockResolvedValueOnce([inA, inB]).mockResolvedValueOnce([outA]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const result = await repo.listRequestsPage(userId, undefined, undefined, 1);

    expect(result.incoming.hasMore).toBe(true);
    expect(result.incoming.items).toEqual([{ ...inA, direction: "incoming" }]);
    expect(result.incoming.nextCursor).toBe(makeCursor(day3, "fri-1"));
    expect(result.outgoing.hasMore).toBe(false);
    expect(result.outgoing.nextCursor).toBeUndefined();
    expect(result.outgoing.items).toEqual([{ ...outA, direction: "outgoing" }]);
  });

  it("returns empty pages when the user has no pending requests", async () => {
    const { select, where, limit } = makeJoinLimitChain();
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    const result = await repo.listRequestsPage(userId, undefined, undefined, 10);

    expect(result.incoming).toEqual({ items: [], hasMore: false });
    expect(result.outgoing).toEqual({ items: [], hasMore: false });
    expect(where).toHaveBeenCalledTimes(2);
  });
});

describe("FriendPgRepository.acceptRequest", () => {
  const requestId = "req-1";
  const convId = "conv-1";
  const acceptedRow = { id: requestId, requesterId: friendId, addresseeId: userId };
  const directKey = `${userId}:${friendId}`;
  const partnerRow = {
    id: friendId,
    username: "friend_a",
    fullName: "Friend A",
    avatarUrl: "a.png",
  };

  it("returns null without touching conversations when no pending request matches", async () => {
    const { db, transaction, update, set, updateWhere, updateReturning, select, insert } =
      makeAcceptDb();
    updateReturning.mockResolvedValueOnce([]);
    const repo = new FriendPgRepository(db);

    await expect(repo.acceptRequest(requestId, userId)).resolves.toBeNull();

    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(friendships);
    expect(select).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    const setValue = set.mock.calls[0][0] as {
      status: string;
      respondedAt: SQL;
      updatedAt: SQL;
    };
    expect(setValue.status).toBe("ACCEPTED");
    expect(render(setValue.respondedAt).sql).toBe("now()");
    expect(render(setValue.updatedAt).sql).toBe("now()");
    expect(updateReturning).toHaveBeenCalledWith({
      id: friendships.id,
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
    });
    const query = render(updateWhere.mock.calls[0][0]);
    expect(query.sql).toContain('"friendships"."id" =');
    expect(query.sql).toContain('"friendships"."addressee_id" =');
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.params).toEqual([requestId, userId, "PENDING"]);
  });

  it("re-joins both participants and returns the conversation with the requester as partner", async () => {
    const { db, updateReturning, selectWhere, limit, insert, values, onConflictDoUpdate } =
      makeAcceptDb();
    updateReturning.mockResolvedValueOnce([acceptedRow]);
    const lastMessageAt = new Date("2026-03-03T00:00:00.000Z");
    const convCreatedAt = new Date("2026-03-01T00:00:00.000Z");
    const conversationRow = {
      id: convId,
      deletedAt: null,
      lastMessagePreview: "hey",
      lastMessageAt,
      createdAt: convCreatedAt,
    };
    limit
      .mockResolvedValueOnce([conversationRow])
      .mockResolvedValueOnce([partnerRow]);
    const repo = new FriendPgRepository(db);

    const result = await repo.acceptRequest(requestId, userId);

    expect(result).toEqual({
      id: requestId,
      requesterId: friendId,
      addresseeId: userId,
      conversation: {
        id: convId,
        kind: "DIRECT",
        partner: { ...partnerRow, isOnline: false },
        lastMessagePreview: "hey",
        lastMessageAt,
        unreadCount: 0,
        createdAt: convCreatedAt,
      },
    });
    expect(limit).toHaveBeenCalledTimes(2);
    const lookup = render(selectWhere.mock.calls[0][0]);
    expect(lookup.sql).toContain('"conversations"."direct_key" =');
    expect(lookup.params).toEqual([directKey]);
    const partnerLookup = render(selectWhere.mock.calls[1][0]);
    expect(partnerLookup.sql).toContain('"users"."id" =');
    expect(partnerLookup.params).toEqual([friendId]);
    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith([
      { conversationId: convId, userId, role: "MEMBER" },
      { conversationId: convId, userId: friendId, role: "MEMBER" },
    ]);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { target: unknown[]; set: unknown };
    expect(conflict.target).toEqual([
      conversationParticipants.conversationId,
      conversationParticipants.userId,
    ]);
    expect(conflict.set).toEqual({ leftAt: null });
  });

  it("creates the direct conversation when the pair has none", async () => {
    const { db, updateReturning, limit, insert, insertReturning, values, onConflictDoNothing } =
      makeAcceptDb();
    updateReturning.mockResolvedValueOnce([acceptedRow]);
    const conversationRow = {
      id: convId,
      deletedAt: null,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: day1,
    };
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([partnerRow]);
    insertReturning.mockResolvedValueOnce([conversationRow]);
    const repo = new FriendPgRepository(db);

    const result = await repo.acceptRequest(requestId, userId);

    expect(result?.conversation).toMatchObject({ id: convId, kind: "DIRECT", unreadCount: 0 });
    expect(values.mock.calls[0][0]).toEqual({ kind: "DIRECT", directKey });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("reuses a concurrently created conversation when the insert conflicts", async () => {
    const { db, updateReturning, selectWhere, limit, insertReturning, values } = makeAcceptDb();
    updateReturning.mockResolvedValueOnce([acceptedRow]);
    const conversationRow = {
      id: convId,
      deletedAt: null,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: day1,
    };
    limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([conversationRow])
      .mockResolvedValueOnce([partnerRow]);
    insertReturning.mockResolvedValueOnce([]);
    const repo = new FriendPgRepository(db);

    const result = await repo.acceptRequest(requestId, userId);

    expect(result?.conversation).toMatchObject({ id: convId });
    expect(insertReturning).toHaveBeenCalledOnce();
    expect(selectWhere).toHaveBeenCalledTimes(3);
    expect(render(selectWhere.mock.calls[0][0]).params).toEqual([directKey]);
    expect(render(selectWhere.mock.calls[1][0]).params).toEqual([directKey]);
    expect(values.mock.calls[0][0]).toEqual({ kind: "DIRECT", directKey });
  });

  it("restores a soft-deleted conversation before re-joining participants", async () => {
    const { db, set, updateWhere, updateReturning, limit, values } = makeAcceptDb();
    const restoredAt = new Date("2026-03-05T00:00:00.000Z");
    updateReturning
      .mockResolvedValueOnce([acceptedRow])
      .mockResolvedValueOnce([
        {
          id: convId,
          deletedAt: null,
          lastMessagePreview: null,
          lastMessageAt: null,
          createdAt: day1,
        },
      ]);
    limit
      .mockResolvedValueOnce([
        {
          id: convId,
          deletedAt: restoredAt,
          lastMessagePreview: null,
          lastMessageAt: null,
          createdAt: day1,
        },
      ])
      .mockResolvedValueOnce([partnerRow]);
    const repo = new FriendPgRepository(db);

    const result = await repo.acceptRequest(requestId, userId);

    expect(result?.conversation).toMatchObject({ id: convId });
    expect(set.mock.calls[1][0]).toEqual({ deletedAt: null });
    const restore = render(updateWhere.mock.calls[1][0]);
    expect(restore.sql).toContain('"conversations"."id" =');
    expect(restore.params).toEqual([convId]);
    expect(values).toHaveBeenCalledOnce();
  });

  it("throws a system error when the accepted friendship has no conversation", async () => {
    const { db, updateReturning, limit, insertReturning } = makeAcceptDb();
    updateReturning.mockResolvedValueOnce([acceptedRow]);
    insertReturning.mockResolvedValueOnce([]);
    const repo = new FriendPgRepository(db);

    const pending = repo.acceptRequest(requestId, userId);
    await expect(pending).rejects.toBeInstanceOf(SystemError);
    await expect(pending).rejects.toThrow("Accepted friendship has no conversation");
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it("throws a system error when the accepting requester no longer exists", async () => {
    const { db, updateReturning, limit } = makeAcceptDb();
    updateReturning.mockResolvedValueOnce([acceptedRow]);
    limit.mockResolvedValueOnce([
      {
        id: convId,
        deletedAt: null,
        lastMessagePreview: null,
        lastMessageAt: null,
        createdAt: day1,
      },
    ]);
    const repo = new FriendPgRepository(db);

    const pending = repo.acceptRequest(requestId, userId);
    await expect(pending).rejects.toBeInstanceOf(SystemError);
    await expect(pending).rejects.toThrow("Accepted friend requester was not found");
  });
});

describe("FriendPgRepository.deleteAcceptedPair", () => {
  it("deletes the accepted pair and reports the deletion", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "fri-1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteAcceptedPair(friendId, userId)).resolves.toBe(true);

    const condition = where.mock.calls[0][0] as SQL;
    const query = render(condition);
    expect(query.sql).toContain('"friendships"."user_low" =');
    expect(query.sql).toContain('"friendships"."user_high" =');
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.params).toEqual([userId, friendId, "ACCEPTED"]);
  });

  it("returns false when the pair is not accepted", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn(() => ({ where }));
    const repo = new FriendPgRepository({ delete: deleteFn } as unknown as DrizzleDb);

    await expect(repo.deleteAcceptedPair(userId, friendId)).resolves.toBe(false);
    expect(returning).toHaveBeenCalledWith({ id: friendships.id });
  });
});

describe("FriendPgRepository.blockPair", () => {
  it("upserts the blocked pair with canonical columns and refreshes timestamps", async () => {
    const onConflictDoUpdate = vi.fn();
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn(() => ({ values }));
    const repo = new FriendPgRepository({ insert } as unknown as DrizzleDb);

    await expect(repo.blockPair(friendId, userId)).resolves.toBeUndefined();

    const inserted = values.mock.calls[0][0] as {
      requesterId: string;
      addresseeId: string;
      userLow: string;
      userHigh: string;
      status: string;
      respondedAt: SQL;
    };
    expect(inserted).toMatchObject({
      requesterId: friendId,
      addresseeId: userId,
      userLow: userId,
      userHigh: friendId,
      status: "BLOCKED",
    });
    expect(render(inserted.respondedAt).sql).toBe("now()");
    const config = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: { requesterId: string; addresseeId: string; status: string; respondedAt: SQL; updatedAt: SQL };
    };
    expect(config.target).toEqual([friendships.userLow, friendships.userHigh]);
    expect(config.set).toMatchObject({
      requesterId: friendId,
      addresseeId: userId,
      status: "BLOCKED",
    });
    expect(render(config.set.respondedAt).sql).toBe("now()");
    expect(render(config.set.updatedAt).sql).toBe("now()");
  });
});
