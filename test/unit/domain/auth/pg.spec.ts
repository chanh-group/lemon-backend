import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import {
  AUTH_LISTENER_CONNECT_TIMEOUT_MS,
  AUTH_LISTENER_RETRY_MS,
  AUTH_REVOCATION_CHANNEL,
} from "../../../../src/domain/auth/constants.js";
import { AuthRevocationListener, AuthSessionPgRepository } from "../../../../src/domain/auth/pg.js";
import { authSessions } from "../../../../src/domain/auth/schema.js";

function toSql(value: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(value as SQL);
}

const { FakeClient } = vi.hoisted(() => {
  class FakeClient {
    static instances: FakeClient[] = [];
    static onConstruct: ((client: FakeClient) => void) | null = null;
    readonly handlers = new Map<string, (payload: unknown) => void>();
    readonly config: unknown;
    readonly connect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    readonly query = vi.fn<(text: string) => Promise<unknown>>().mockResolvedValue(undefined);
    readonly end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    constructor(config: unknown) {
      this.config = config;
      FakeClient.instances.push(this);
      FakeClient.onConstruct?.(this);
    }

    on(event: string, handler: (payload: unknown) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    emit(event: string, payload: unknown): void {
      this.handlers.get(event)?.(payload);
    }
  }
  return { FakeClient };
});

vi.mock("pg", () => ({ Client: FakeClient }));

describe("AuthSessionPgRepository", () => {
  let repository: AuthSessionPgRepository;
  let tx: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  let transactionMock: ReturnType<typeof vi.fn>;
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
    transactionMock = vi.fn((callback: (db: typeof tx) => Promise<unknown>) => callback(tx));
    mockDb = { ...tx, transaction: transactionMock };
    repository = new AuthSessionPgRepository(mockDb as DrizzleDb);
  });

  describe("create", () => {
    it("inserts the session row keyed by its session id", async () => {
      const values = vi.fn().mockResolvedValueOnce(undefined);
      tx.insert.mockReturnValueOnce({ values });

      await repository.create(userId, sessionId, expiresAt);

      expect(tx.insert).toHaveBeenCalledWith(authSessions);
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
      expect(condition.params).toEqual([userId, sessionId]);
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
      expect(sessionCondition.params).toEqual([userId, sessionId]);
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
      expect(userCondition.params).toEqual([userId]);
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

    it("updates the expiry of the matching unexpired session only", async () => {
      const set = vi.fn().mockReturnThis();
      const where = vi.fn().mockReturnThis();
      const returning = vi.fn().mockResolvedValueOnce([{ id: sessionId }]);
      tx.update.mockReturnValueOnce({ set, where, returning });

      await repository.extend(userId, sessionId, expiresAt);

      expect(tx.update).toHaveBeenCalledWith(authSessions);
      expect(set).toHaveBeenCalledWith({ expiresAt });
      expect(returning).toHaveBeenCalledWith({ id: authSessions.id });
      const condition = toSql(where.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."user_id" =');
      expect(condition.sql).toContain('"auth_sessions"."id" =');
      expect(condition.sql).toContain('"auth_sessions"."expires_at" > now()');
      expect(condition.params).toEqual([userId, sessionId]);
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

    it("scopes the delete to the given session and notifies the session scope in one transaction", async () => {
      const where = vi.fn().mockResolvedValueOnce(undefined);
      tx.delete.mockReturnValueOnce({ where });

      await repository.revoke(userId, sessionId);

      expect(transactionMock).toHaveBeenCalledOnce();
      expect(tx.delete).toHaveBeenCalledWith(authSessions);
      const condition = toSql(where.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."user_id" =');
      expect(condition.sql).toContain('"auth_sessions"."id" =');
      expect(condition.params).toEqual([userId, sessionId]);
      const notify = toSql(tx.execute.mock.calls[0][0]);
      expect(notify.sql).toContain("pg_notify");
      expect(notify.params).toEqual([AUTH_REVOCATION_CHANNEL, `s:${sessionId}`]);
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

    it("deletes every session of the user and notifies the user scope in one transaction", async () => {
      const where = vi.fn().mockResolvedValueOnce(undefined);
      tx.delete.mockReturnValueOnce({ where });

      await repository.revokeAll(userId);

      expect(transactionMock).toHaveBeenCalledOnce();
      expect(tx.delete).toHaveBeenCalledWith(authSessions);
      const condition = toSql(where.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."user_id" =');
      expect(condition.params).toEqual([userId]);
      const notify = toSql(tx.execute.mock.calls[0][0]);
      expect(notify.sql).toContain("pg_notify");
      expect(notify.params).toEqual([AUTH_REVOCATION_CHANNEL, `u:${userId}`]);
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
      expect(returning).toHaveBeenCalledWith({ id: authSessions.id });
      const condition = toSql(deleteWhere.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."expires_at" <= now()');
    });

    it("selects expired candidates with the same expiry rule before deleting them", async () => {
      const subqueryWhere = vi.fn().mockReturnThis();
      const subqueryLimit = vi.fn().mockReturnValue(sql`expired_sessions`);
      tx.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: subqueryWhere,
        limit: subqueryLimit,
      });
      const deleteWhere = vi.fn().mockReturnThis();
      const returning = vi.fn().mockResolvedValueOnce([]);
      tx.delete.mockReturnValueOnce({ where: deleteWhere, returning });

      await expect(repository.purgeExpired(3)).resolves.toBe(0);

      expect(subqueryLimit).toHaveBeenCalledWith(3);
      const candidateCondition = toSql(subqueryWhere.mock.calls[0][0]);
      expect(candidateCondition.sql).toContain('"auth_sessions"."expires_at" <= now()');
      const condition = toSql(deleteWhere.mock.calls[0][0]);
      expect(condition.sql).toContain('"auth_sessions"."id" in');
      expect(condition.sql).toContain('"auth_sessions"."expires_at" <= now()');
    });
  });
});

describe("AuthRevocationListener", () => {
  const listenerUserId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a7b";
  const otherListenerUserId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a7e";
  const listenerSessionId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a7c";
  const otherSessionId = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a7d";
  const databaseUrl = "postgres://auth-listener.test/lemon_chat";

  let listener: AuthRevocationListener;
  let logger: ReturnType<typeof spyLogger>;
  let previousDatabaseUrl: string | undefined;

  function spyLogger() {
    return {
      warn: vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined),
    };
  }

  function client(): InstanceType<typeof FakeClient> {
    const last = FakeClient.instances.at(-1);
    if (!last) throw new Error("no fake pg Client was constructed");
    return last;
  }

  beforeEach(() => {
    FakeClient.instances.length = 0;
    FakeClient.onConstruct = null;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    logger = spyLogger();
    listener = new AuthRevocationListener();
  });

  afterEach(async () => {
    await listener.onModuleDestroy();
    logger.warn.mockRestore();
    logger.error.mockRestore();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  describe("onModuleInit", () => {
    it("connects with the DATABASE_URL string and listens on the revocation channel", async () => {
      await listener.onModuleInit();

      expect(FakeClient.instances).toHaveLength(1);
      expect(client().config).toEqual({
        connectionString: databaseUrl,
        connectionTimeoutMillis: AUTH_LISTENER_CONNECT_TIMEOUT_MS,
        keepAlive: true,
      });
      expect(client().connect).toHaveBeenCalledOnce();
      expect(client().query).toHaveBeenCalledWith(`LISTEN ${AUTH_REVOCATION_CHANNEL}`);
    });

    it("does not open a second connection while one is active", async () => {
      await listener.onModuleInit();
      await listener.onModuleInit();

      expect(FakeClient.instances).toHaveLength(1);
    });

    it("does not connect once the module has been destroyed", async () => {
      await listener.onModuleDestroy();

      await listener.onModuleInit();

      expect(FakeClient.instances).toHaveLength(0);
      expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeNull();
    });

    it("stays unready when the module shuts down while connecting", async () => {
      FakeClient.onConstruct = (constructed) => {
        constructed.connect.mockImplementation(async () => {
          await listener.onModuleDestroy();
        });
      };

      await listener.onModuleInit();

      expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeNull();
    });
  });

  describe("track", () => {
    it("refuses to track sockets before the listener is connected", () => {
      const disconnect = vi.fn();

      expect(listener.track(listenerUserId, listenerSessionId, disconnect)).toBeNull();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it("returns an untrack function that detaches the socket", async () => {
      await listener.onModuleInit();
      const disconnect = vi.fn();
      const untrack = listener.track(listenerUserId, listenerSessionId, disconnect);

      expect(untrack).toBeInstanceOf(Function);
      untrack?.();
      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `s:${listenerSessionId}`,
      });

      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  describe("revocation notifications", () => {
    it("disconnects only the socket bound to the revoked session", async () => {
      await listener.onModuleInit();
      const revoked = vi.fn();
      const kept = vi.fn();
      listener.track(listenerUserId, listenerSessionId, revoked);
      listener.track(listenerUserId, otherSessionId, kept);

      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `s:${listenerSessionId}`,
      });

      expect(revoked).toHaveBeenCalledOnce();
      expect(kept).not.toHaveBeenCalled();

      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `s:${listenerSessionId}`,
      });
      expect(revoked).toHaveBeenCalledOnce();
    });

    it("disconnects every socket of the revoked user across sessions", async () => {
      await listener.onModuleInit();
      const first = vi.fn();
      const second = vi.fn();
      const untouched = vi.fn();
      listener.track(listenerUserId, listenerSessionId, first);
      listener.track(listenerUserId, otherSessionId, second);
      listener.track(otherListenerUserId, otherSessionId, untouched);

      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `u:${listenerUserId}`,
      });

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      expect(untouched).not.toHaveBeenCalled();
    });

    it("ignores notifications on other channels", async () => {
      await listener.onModuleInit();
      const disconnect = vi.fn();
      listener.track(listenerUserId, listenerSessionId, disconnect);

      client().emit("notification", {
        channel: "other_channel",
        payload: `s:${listenerSessionId}`,
      });

      expect(disconnect).not.toHaveBeenCalled();
    });

    it("ignores notifications without a payload", async () => {
      await listener.onModuleInit();
      const disconnect = vi.fn();
      listener.track(listenerUserId, listenerSessionId, disconnect);

      client().emit("notification", { channel: AUTH_REVOCATION_CHANNEL, payload: "" });

      expect(disconnect).not.toHaveBeenCalled();
    });

    it("ignores payloads without an identifier or with an unknown scope", async () => {
      await listener.onModuleInit();
      const disconnect = vi.fn();
      listener.track(listenerUserId, listenerSessionId, disconnect);

      client().emit("notification", { channel: AUTH_REVOCATION_CHANNEL, payload: "s:" });
      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `x:${listenerSessionId}`,
      });

      expect(disconnect).not.toHaveBeenCalled();
    });

    it("keeps disconnecting other sockets when one disconnect throws", async () => {
      await listener.onModuleInit();
      const throwing = vi.fn<() => void>(() => {
        throw new Error("socket already closed");
      });
      const healthy = vi.fn();
      listener.track(listenerUserId, listenerSessionId, throwing);
      listener.track(listenerUserId, otherSessionId, healthy);

      client().emit("notification", {
        channel: AUTH_REVOCATION_CHANNEL,
        payload: `u:${listenerUserId}`,
      });

      expect(throwing).toHaveBeenCalledOnce();
      expect(healthy).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to disconnect revoked socket",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("disconnects every socket and closes the client", async () => {
      await listener.onModuleInit();
      const first = vi.fn();
      const second = vi.fn();
      listener.track(listenerUserId, listenerSessionId, first);
      listener.track(otherListenerUserId, otherSessionId, second);

      await listener.onModuleDestroy();

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      expect(client().end).toHaveBeenCalledOnce();
      expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeNull();
    });

    it("warns instead of throwing when closing the client fails", async () => {
      await listener.onModuleInit();
      client().end.mockRejectedValueOnce(new Error("socket already closed"));

      await expect(listener.onModuleDestroy()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to close auth listener",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it("resolves without a client when nothing was ever connected", async () => {
      await expect(listener.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe("connection failures", () => {
    it("drops every socket and reconnects after the retry delay", async () => {
      vi.useFakeTimers();
      try {
        await listener.onModuleInit();
        const disconnect = vi.fn();
        listener.track(listenerUserId, listenerSessionId, disconnect);
        const first = client();

        first.emit("error", new Error("connection reset"));

        expect(disconnect).toHaveBeenCalledOnce();
        expect(first.end).toHaveBeenCalledOnce();
        expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          "Auth revocation listener unavailable",
          expect.objectContaining({ err: expect.any(Error) }),
        );

        await vi.advanceTimersByTimeAsync(AUTH_LISTENER_RETRY_MS);

        expect(FakeClient.instances).toHaveLength(2);
        expect(client().connect).toHaveBeenCalledOnce();
        expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeInstanceOf(Function);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reconnects when the connection ends unexpectedly", async () => {
      vi.useFakeTimers();
      try {
        await listener.onModuleInit();
        const first = client();

        first.emit("end", undefined);

        expect(first.end).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(AUTH_LISTENER_RETRY_MS);
        expect(FakeClient.instances).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores failures of a stale connection after a reconnect", async () => {
      vi.useFakeTimers();
      try {
        await listener.onModuleInit();
        const first = client();
        first.emit("error", new Error("connection reset"));
        await vi.advanceTimersByTimeAsync(AUTH_LISTENER_RETRY_MS);
        const disconnect = vi.fn();
        listener.track(listenerUserId, listenerSessionId, disconnect);

        first.emit("error", new Error("stale failure"));
        await vi.advanceTimersByTimeAsync(AUTH_LISTENER_RETRY_MS * 2);

        expect(disconnect).not.toHaveBeenCalled();
        expect(FakeClient.instances).toHaveLength(2);
        expect(FakeClient.instances[1].end).not.toHaveBeenCalled();
        expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeInstanceOf(Function);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports and retries when the initial connection fails", async () => {
      FakeClient.onConstruct = (constructed) => {
        constructed.connect.mockRejectedValueOnce(new Error("connection refused"));
      };

      await listener.onModuleInit();

      expect(FakeClient.instances[0].query).not.toHaveBeenCalled();
      expect(listener.track(listenerUserId, listenerSessionId, vi.fn())).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Auth revocation listener unavailable",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it("warns when a broken connection cannot be closed", async () => {
      await listener.onModuleInit();
      client().end.mockRejectedValueOnce(new Error("socket gone"));

      client().emit("error", new Error("connection reset"));

      await vi.waitFor(() =>
        expect(logger.warn).toHaveBeenCalledWith(
          "Failed to close auth listener",
          expect.objectContaining({ err: expect.any(Error) }),
        ),
      );
    });
  });
});
