import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { AuthSessionPgRepository } from "../../../../src/domain/auth/pg.js";

function toSql(value: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe("AuthSessionPgRepository", () => {
  let repository: AuthSessionPgRepository;
  let tx: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  let mockDb: unknown;

  const userId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b";
  const sessionId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6c";
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");

  function selectChain(rows: unknown[]): Record<string, ReturnType<typeof vi.fn>> {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce(rows),
    };
  }

  beforeEach(() => {
    tx = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb = {
      ...tx,
      transaction: vi.fn((callback: (db: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    repository = new AuthSessionPgRepository(mockDb as DrizzleDb);
  });

  describe("create", () => {
    it("inserts the session row keyed by its session id", async () => {
      const values = vi.fn().mockResolvedValueOnce(undefined);
      tx.insert.mockReturnValueOnce({ values });

      await repository.create(userId, sessionId, expiresAt);

      expect(values).toHaveBeenCalledWith({ id: sessionId, userId, expiresAt });
    });
  });

  describe("isActive", () => {
    it("returns true when an unexpired session row exists", async () => {
      tx.select.mockReturnValueOnce(selectChain([{ id: sessionId }]));

      await expect(repository.isActive(userId, sessionId)).resolves.toBe(true);
    });

    it("returns false when the session is missing or expired", async () => {
      tx.select.mockReturnValueOnce(selectChain([]));

      await expect(repository.isActive(userId, sessionId)).resolves.toBe(false);
    });

    it("matches only sessions whose expires_at is still in the future", async () => {
      const chain = selectChain([]);
      tx.select.mockReturnValueOnce(chain);

      await repository.isActive(userId, sessionId);

      const condition = toSql(chain.where.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."expires_at" > now()');
      expect(condition.sql).toContain('"auth_sessions"."user_id" =');
      expect(condition.sql).toContain('"auth_sessions"."id" =');
    });
  });

  describe("findAuthState", () => {
    it("loads the user row and the session state in one database round trip", async () => {
      const innerChain = selectChain([]);
      const outerChain = selectChain([{ isActive: true, authVersion: 3, sessionActive: true }]);
      tx.select.mockReturnValueOnce(innerChain).mockReturnValueOnce(outerChain);

      await expect(repository.findAuthState(userId, sessionId)).resolves.toEqual({
        isActive: true,
        authVersion: 3,
        sessionActive: true,
      });
      expect(innerChain.limit).not.toHaveBeenCalled();
      expect(outerChain.limit).toHaveBeenCalledOnce();
      expect(outerChain.limit).toHaveBeenCalledWith(1);
    });

    it("selects only the three auth state columns", async () => {
      const innerChain = selectChain([]);
      const outerChain = selectChain([{ isActive: true, authVersion: 0, sessionActive: true }]);
      tx.select.mockReturnValueOnce(innerChain).mockReturnValueOnce(outerChain);

      await repository.findAuthState(userId, sessionId);

      expect(Object.keys(tx.select.mock.calls[1][0] as Record<string, unknown>)).toEqual([
        "isActive",
        "authVersion",
        "sessionActive",
      ]);
    });

    it("returns null when the user is missing or soft-deleted", async () => {
      tx.select.mockReturnValueOnce(selectChain([])).mockReturnValueOnce(selectChain([]));

      await expect(repository.findAuthState(userId, sessionId)).resolves.toBeNull();
    });

    it("reports an inactive session when no unexpired session row exists", async () => {
      const innerChain = selectChain([]);
      const outerChain = selectChain([{ isActive: true, authVersion: 0, sessionActive: false }]);
      tx.select.mockReturnValueOnce(innerChain).mockReturnValueOnce(outerChain);

      await expect(repository.findAuthState(userId, sessionId)).resolves.toEqual({
        isActive: true,
        authVersion: 0,
        sessionActive: false,
      });
    });

    it("checks session activity with the same expiry rule as isActive", async () => {
      const innerChain = selectChain([]);
      const outerChain = selectChain([{ isActive: true, authVersion: 0, sessionActive: true }]);
      tx.select.mockReturnValueOnce(innerChain).mockReturnValueOnce(outerChain);

      await repository.findAuthState(userId, sessionId);

      const sessionCondition = toSql(innerChain.where.mock.calls[0][0]);
      expect(sessionCondition.sql).toContain('"auth_sessions"."expires_at" > now()');
      expect(sessionCondition.sql).toContain('"auth_sessions"."user_id" =');
      expect(sessionCondition.sql).toContain('"auth_sessions"."id" =');
      const sessionField = toSql(tx.select.mock.calls[1][0].sessionActive);
      expect(sessionField.sql).toContain("exists");
    });

    it("ignores soft-deleted users", async () => {
      const innerChain = selectChain([]);
      const outerChain = selectChain([]);
      tx.select.mockReturnValueOnce(innerChain).mockReturnValueOnce(outerChain);

      await repository.findAuthState(userId, sessionId);

      const userCondition = toSql(outerChain.where.mock.calls[0][0]);
      expect(userCondition.sql).toContain('"users"."id" =');
      expect(userCondition.sql).toContain('"users"."deleted_at" is null');
    });
  });

  describe("extend", () => {
    it("returns true when an unexpired session was extended", async () => {
      const returning = vi.fn().mockResolvedValueOnce([{ id: sessionId }]);
      tx.update.mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning,
      });

      await expect(repository.extend(userId, sessionId, expiresAt)).resolves.toBe(true);
    });

    it("returns false when the session is missing or already expired", async () => {
      const returning = vi.fn().mockResolvedValueOnce([]);
      tx.update.mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning,
      });

      await expect(repository.extend(userId, sessionId, expiresAt)).resolves.toBe(false);
    });
  });

  describe("revoke", () => {
    it("deletes the session and notifies the revocation channel", async () => {
      const where = vi.fn().mockResolvedValueOnce(undefined);
      tx.delete.mockReturnValueOnce({ where });

      await repository.revoke(userId, sessionId);

      expect(where).toHaveBeenCalledOnce();
      expect(tx.execute).toHaveBeenCalledOnce();
      const notify = toSql(tx.execute.mock.calls[0][0]);
      expect(notify.sql).toContain("pg_notify");
      expect(notify.params).toContain(`s:${sessionId}`);
    });
  });

  describe("revokeAll", () => {
    it("deletes every session of the user and notifies the revocation channel", async () => {
      const where = vi.fn().mockResolvedValueOnce(undefined);
      tx.delete.mockReturnValueOnce({ where });

      await repository.revokeAll(userId);

      expect(where).toHaveBeenCalledOnce();
      expect(tx.execute).toHaveBeenCalledOnce();
      const notify = toSql(tx.execute.mock.calls[0][0]);
      expect(notify.sql).toContain("pg_notify");
      expect(notify.params).toContain(`u:${userId}`);
    });
  });

  describe("purgeExpired", () => {
    it("deletes expired sessions up to the limit and returns the count", async () => {
      const subqueryLimit = vi.fn().mockReturnValue(sql`expired_sessions`);
      tx.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: subqueryLimit,
      });
      const deleteWhere = vi.fn().mockReturnThis();
      const returning = vi.fn().mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
      tx.delete.mockReturnValueOnce({ where: deleteWhere, returning });

      await expect(repository.purgeExpired(5)).resolves.toBe(2);

      expect(subqueryLimit).toHaveBeenCalledWith(5);
      const condition = toSql(deleteWhere.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."expires_at" <= now()');
    });
  });
});
