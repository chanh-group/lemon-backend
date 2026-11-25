import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { CALL_ACTIVE_LOCK_TTL_SECONDS } from "../../../../src/domain/call/constants.js";
import { CallPgRepository } from "../../../../src/domain/call/pg.js";
import type { Call } from "../../../../src/domain/call/schema.js";

function makeWhereResult(rows: unknown[] = []) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  return Object.assign(Promise.resolve(rows), {
    orderBy: orderByMock,
  });
}

function makeDb() {
  const whereMock = vi.fn((_condition: SQL) => makeWhereResult([]));
  const leftJoinMock2 = vi.fn(() => ({ where: whereMock }));
  const leftJoinMock1 = vi.fn(() => ({ leftJoin: leftJoinMock2 }));
  const fromMock = vi.fn(() => ({ leftJoin: leftJoinMock1 }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const updateReturningMock = vi.fn().mockResolvedValue([]);
  const updateWhereMock = vi.fn((_condition: SQL) => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn((_values: Record<string, unknown>) => ({
    where: updateWhereMock,
  }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const insertReturningMock = vi.fn().mockResolvedValue([]);
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const db = {
    select: selectMock,
    insert: insertMock,
    update: updateMock,
  } as unknown as DrizzleDb;

  return {
    db,
    selectMock,
    fromMock,
    whereMock,
    insertMock,
    insertValuesMock,
    insertReturningMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    updateReturningMock,
  };
}

const render = (condition: SQL) => new PgDialect().sqlToQuery(condition);

describe("CallPgRepository", () => {
  const callerId = "0193a2b1-0000-7000-8000-000000000001";
  const calleeId = "0193a2b1-0000-7000-8000-000000000002";
  const convId = "0193a2b1-0000-7000-8000-000000000010";
  const callId = "0193a2b1-0000-7000-8000-000000000020";

  const rawCall: Call = {
    id: callId,
    conversationId: convId,
    callerId,
    calleeId,
    media: "VIDEO",
    status: "INITIATED",
    startedAt: new Date("2026-11-20T10:00:00Z"),
    answeredAt: null,
    endedAt: null,
    endReason: null,
    durationSecs: 0,
  };

  const rawRow = {
    call: rawCall,
    caller: {
      id: callerId,
      username: "caller_user",
      fullName: "Caller User",
      avatarUrl: null,
    },
    callee: {
      id: calleeId,
      username: "callee_user",
      fullName: "Callee User",
      avatarUrl: null,
    },
  };

  it("findById returns mapped call with caller and callee", async () => {
    const { db, whereMock } = makeDb();
    whereMock.mockReturnValueOnce(makeWhereResult([rawRow]));

    const repo = new CallPgRepository(db);
    const result = await repo.findById(callId);

    expect(result).toBeDefined();
    expect(result?.id).toBe(callId);
    expect(result?.caller?.username).toBe("caller_user");
    expect(result?.callee?.username).toBe("callee_user");
  });

  it("findById returns null when row is not found", async () => {
    const { db, whereMock } = makeDb();
    whereMock.mockReturnValueOnce(makeWhereResult([]));

    const repo = new CallPgRepository(db);
    const result = await repo.findById("non-existent");

    expect(result).toBeNull();
  });

  it("createCall inserts call and retrieves with users", async () => {
    const { db, insertReturningMock, whereMock } = makeDb();
    insertReturningMock.mockResolvedValueOnce([rawCall]);
    whereMock.mockReturnValueOnce(makeWhereResult([rawRow]));

    const repo = new CallPgRepository(db);
    const result = await repo.createCall({
      conversationId: convId,
      callerId,
      calleeId,
      media: "VIDEO",
    });

    expect(result.id).toBe(callId);
    expect(result.caller?.id).toBe(callerId);
  });

  it("findActiveCallForUser finds active call", async () => {
    const { db, whereMock } = makeDb();
    whereMock.mockReturnValueOnce(makeWhereResult([rawRow]));

    const repo = new CallPgRepository(db);
    const result = await repo.findActiveCallForUser(callerId);

    expect(result?.id).toBe(callId);
    const query = render(whereMock.mock.calls[0][0]);
    expect(query.sql).toContain('"calls"."answered_at"');
    expect(query.sql).toContain('"calls"."started_at"');
    expect(query.params).toContainEqual(expect.any(Date));
  });

  it("updateStatus updates status atomically and returns updated call", async () => {
    const { db, updateReturningMock, whereMock } = makeDb();
    updateReturningMock.mockResolvedValueOnce([{ ...rawCall, status: "ACCEPTED" }]);
    whereMock.mockReturnValueOnce(
      makeWhereResult([
        {
          ...rawRow,
          call: { ...rawCall, status: "ACCEPTED" },
        },
      ]),
    );

    const repo = new CallPgRepository(db);
    const result = await repo.updateStatus(callId, ["INITIATED"], {
      status: "ACCEPTED",
      answeredAt: new Date(),
    });

    expect(result?.status).toBe("ACCEPTED");
  });

  it("updateStatus returns null if status condition does not match", async () => {
    const { db, updateReturningMock } = makeDb();
    updateReturningMock.mockResolvedValueOnce([]);

    const repo = new CallPgRepository(db);
    const result = await repo.updateStatus(callId, ["ACCEPTED"], {
      status: "COMPLETED",
    });

    expect(result).toBeNull();
  });

  it("findCallsByConversation paginates calls", async () => {
    const { db, whereMock } = makeDb();
    whereMock.mockReturnValueOnce(makeWhereResult([rawRow]));

    const repo = new CallPgRepository(db);
    const page = await repo.findCallsByConversation(convId, 10);

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it("findCallsByUser paginates calls for user", async () => {
    const { db, whereMock } = makeDb();
    whereMock.mockReturnValueOnce(makeWhereResult([rawRow]));

    const repo = new CallPgRepository(db);
    const page = await repo.findCallsByUser(callerId, 10);

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it("cleanupStaleCalls closes expired ringing and accepted calls", async () => {
    const { db, updateReturningMock, updateWhereMock, updateSetMock } = makeDb();
    updateReturningMock
      .mockResolvedValueOnce([rawCall])
      .mockResolvedValueOnce([{ ...rawCall, status: "COMPLETED", endReason: "MAX_DURATION" }]);

    const repo = new CallPgRepository(db);
    const cleaned = await repo.cleanupStaleCalls();

    expect(cleaned).toHaveLength(2);
    expect(cleaned[0].id).toBe(callId);

    const staleRingingQuery = render(updateWhereMock.mock.calls[0][0]);
    expect(staleRingingQuery.sql).toContain('"calls"."status" in');
    const staleAcceptedQuery = render(updateWhereMock.mock.calls[1][0]);
    expect(staleAcceptedQuery.sql).toContain('"calls"."status" =');
    expect(staleAcceptedQuery.sql).toContain(
      'coalesce("calls"."answered_at", "calls"."started_at") <=',
    );
    expect(staleAcceptedQuery.params).toContain("ACCEPTED");
    const acceptedThreshold = staleAcceptedQuery.params.find(
      (param): param is Date => param instanceof Date,
    );
    expect(acceptedThreshold).toBeDefined();
    if (!acceptedThreshold) throw new Error("Missing accepted call threshold");
    expect(
      Math.abs(Date.now() - CALL_ACTIVE_LOCK_TTL_SECONDS * 1000 - acceptedThreshold.getTime()),
    ).toBeLessThan(1000);

    expect(updateSetMock.mock.calls[1][0]).toMatchObject({
      status: "COMPLETED",
      endReason: "MAX_DURATION",
    });
    const endedAt = (updateSetMock.mock.calls[1][0] as { endedAt: SQL }).endedAt;
    expect(render(endedAt).sql).toContain("interval '1 second'");
  });
});
