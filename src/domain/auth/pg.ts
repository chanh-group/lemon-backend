import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Client } from "pg";
import type { DrizzleDb } from "../../configs/database.js";
import { get_env } from "../../helpers/index.js";
import {
  AUTH_LISTENER_CONNECT_TIMEOUT_MS,
  AUTH_LISTENER_RETRY_MS,
  AUTH_REVOCATION_CHANNEL,
} from "./constants.js";
import type { AuthSessionRepository } from "./repository.js";
import { authSessions } from "./schema.js";

@Injectable()
export class AuthSessionPgRepository implements AuthSessionRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async create(userId: string, sessionId: string, expiresAt: Date): Promise<void> {
    await this.db.insert(authSessions).values({ id: sessionId, userId, expiresAt });
  }

  async isActive(userId: string, sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          eq(authSessions.id, sessionId),
          gt(authSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async extend(userId: string, sessionId: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(authSessions)
      .set({ expiresAt })
      .where(
        and(
          eq(authSessions.userId, userId),
          eq(authSessions.id, sessionId),
          gt(authSessions.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: authSessions.id });
    return rows.length > 0;
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(authSessions)
        .where(and(eq(authSessions.userId, userId), eq(authSessions.id, sessionId)));
      await tx.execute(sql`select pg_notify(${AUTH_REVOCATION_CHANNEL}, ${`s:${sessionId}`})`);
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(authSessions).where(eq(authSessions.userId, userId));
      await tx.execute(sql`select pg_notify(${AUTH_REVOCATION_CHANNEL}, ${`u:${userId}`})`);
    });
  }

  async purgeExpired(limit: number): Promise<number> {
    const ids = this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(lte(authSessions.expiresAt, sql`now()`))
      .limit(limit);
    const rows = await this.db
      .delete(authSessions)
      .where(and(inArray(authSessions.id, ids), lte(authSessions.expiresAt, sql`now()`)))
      .returning({ id: authSessions.id });
    return rows.length;
  }
}

@Injectable()
export class AuthRevocationListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthRevocationListener.name);
  private readonly sockets = new Map<
    symbol,
    { userId: string; sid: string; disconnect: () => void }
  >();
  private client: Client | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ready = false;

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  track(userId: string, sid: string, disconnect: () => void): (() => void) | null {
    if (!this.ready) return null;
    const id = Symbol();
    this.sockets.set(id, { userId, sid, disconnect });
    return () => {
      this.sockets.delete(id);
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    if (this.retry) clearTimeout(this.retry);
    this.disconnectMatching(() => true);
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.end();
      } catch (err) {
        this.logger.warn("Failed to close auth listener", { err });
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.client) return;
    const client = new Client({
      connectionString: get_env(
        "DATABASE_URL",
        "postgres://postgres:postgres@localhost:5432/lemon_chat",
      ),
      connectionTimeoutMillis: AUTH_LISTENER_CONNECT_TIMEOUT_MS,
      keepAlive: true,
    });
    this.client = client;
    client.on("notification", (message) => {
      if (message.channel !== AUTH_REVOCATION_CHANNEL || !message.payload) return;
      const [scope, id] = message.payload.split(":");
      if (scope === "s" && id) this.disconnectMatching((socket) => socket.sid === id);
      else if (scope === "u" && id) this.disconnectMatching((socket) => socket.userId === id);
    });
    client.on("error", (err) => this.connectionLost(client, err));
    client.on("end", () => this.connectionLost(client, new Error("PostgreSQL listener ended")));
    try {
      await client.connect();
      await client.query(`LISTEN ${AUTH_REVOCATION_CHANNEL}`);
      if (this.client === client && !this.stopped) this.ready = true;
    } catch (err) {
      this.connectionLost(client, err);
    }
  }

  private connectionLost(client: Client, err: unknown): void {
    if (this.client !== client) return;
    this.client = null;
    this.ready = false;
    this.disconnectMatching(() => true);
    void client
      .end()
      .catch((endErr: unknown) =>
        this.logger.warn("Failed to close auth listener", { err: endErr }),
      );
    if (!this.stopped) {
      this.logger.error("Auth revocation listener unavailable", { err });
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.connect();
      }, AUTH_LISTENER_RETRY_MS);
      this.retry.unref();
    }
  }

  private disconnectMatching(matches: (socket: { userId: string; sid: string }) => boolean): void {
    for (const [id, socket] of this.sockets) {
      if (!matches(socket)) continue;
      this.sockets.delete(id);
      try {
        socket.disconnect();
      } catch (err) {
        this.logger.error("Failed to disconnect revoked socket", { err });
      }
    }
  }
}
