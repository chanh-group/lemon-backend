import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getDrizzleToken } from "@nestjs/drizzle";
import * as argon2 from "argon2";
import cookieParser from "cookie-parser";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.js";
import type { DrizzleDb } from "../../src/configs/database.js";
import { AuthService } from "../../src/domain/auth/service.js";
import { AuthRevocationListener } from "../../src/domain/auth/pg.js";
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from "../../src/domain/auth/repository.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { CacheError } from "../../src/utils/cache/error.js";
import { SESSION_KEY_PREFIX } from "../../src/utils/cache/constants.js";
import { CACHE_STORE, type CacheStore } from "../../src/utils/cache/store.js";
import { SystemError } from "../../src/utils/errors/system.js";

describe("durable password revocation with PostgreSQL and Redis", () => {
  let app: INestApplication;
  let otherNode: INestApplication;
  let db: DrizzleDb;
  let auth: AuthService;
  let cache: CacheStore;
  let sessions: AuthSessionRepository;
  const userId = uuidv7();
  const username = `auth${Date.now()}`;
  const oldPassword = "OldPassword#123";
  const newPassword = "NewPassword#456";

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    app.useGlobalFilters(new ErrorFilter());
    await app.init();
    await app.listen(0);
    const otherModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    otherNode = otherModule.createNestApplication();
    await otherNode.init();
    await otherNode.listen(0);
    db = module.get<DrizzleDb>(getDrizzleToken());
    auth = module.get(AuthService);
    cache = module.get<CacheStore>(CACHE_STORE);
    sessions = module.get<AuthSessionRepository>(AUTH_SESSION_REPOSITORY);
    await db.insert(users).values({
      id: userId,
      email: `${username}@example.test`,
      username,
      fullName: "Auth Version Test",
      passwordHash: await argon2.hash(oldPassword),
      emailVerifiedAt: new Date(),
    });
  });

  it("purges expired sessions without removing active sessions", async () => {
    const expired = uuidv7();
    const active = uuidv7();
    await Promise.all([
      sessions.create(userId, expired, new Date(Date.now() - 60_000)),
      sessions.create(userId, active, new Date(Date.now() + 60_000)),
    ]);
    expect(await sessions.purgeExpired(100)).toBeGreaterThanOrEqual(1);
    expect(await sessions.isActive(userId, expired)).toBe(false);
    expect(await sessions.isActive(userId, active)).toBe(true);
    await sessions.revoke(userId, active);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (cache) await cache.revokeRefreshFamily(`${SESSION_KEY_PREFIX}${userId}`, []);
    if (db) await db.delete(users).where(eq(users.id, userId));
    if (otherNode) await otherNode.close();
    if (app) await app.close();
  });

  async function connectOnOtherNode(token: string): Promise<Socket> {
    const socket = io(await otherNode.getUrl(), {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      socket
        .timeout(5000)
        .emit("conv:join", { conversationId: uuidv7() }, (err: Error | null) =>
          err ? reject(err) : resolve(),
        );
    });
    return socket;
  }

  it("revokes only the logged-out session in PostgreSQL even if Redis fails", async () => {
    const first = await auth.login({ identifier: username, password: oldPassword });
    const second = await auth.login({ identifier: username, password: oldPassword });
    const [firstSocket, secondSocket] = await Promise.all([
      connectOnOtherNode(first.tokens.accessToken),
      connectOnOtherNode(second.tokens.accessToken),
    ]);
    const disconnected = new Promise<string>((resolve) => firstSocket.once("disconnect", resolve));
    const failure = vi
      .spyOn(cache, "revokeRefreshSession")
      .mockRejectedValueOnce(new CacheError("revoke"));

    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Cookie", `refreshCookie=${first.tokens.refreshToken}`)
      .expect(503);
    expect(await disconnected).toBe("io server disconnect");
    expect(secondSocket.connected).toBe(true);
    secondSocket.disconnect();
    failure.mockRestore();
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .auth(first.tokens.accessToken, { type: "bearer" })
      .expect(401);
    await expect(auth.refreshToken(first.tokens.refreshToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .auth(second.tokens.accessToken, { type: "bearer" })
      .expect(200);
    await expect(auth.refreshToken(second.tokens.refreshToken)).resolves.toHaveProperty(
      "accessToken",
    );
  });

  it("rejects old access and refresh tokens when Redis revocation fails after password commit", async () => {
    const old = await auth.login({ identifier: username, password: oldPassword });
    const existingSocket = await connectOnOtherNode(old.tokens.accessToken);
    const disconnected = new Promise<string>((resolve) =>
      existingSocket.once("disconnect", resolve),
    );
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .auth(old.tokens.accessToken, { type: "bearer" })
      .expect(200);

    const failure = vi
      .spyOn(cache, "revokeRefreshFamily")
      .mockRejectedValueOnce(new CacheError("family revocation"));
    await expect(auth.changePassword(userId, { oldPassword, newPassword })).rejects.toBeInstanceOf(
      SystemError,
    );
    expect(await disconnected).toBe("io server disconnect");
    failure.mockRestore();

    await request(app.getHttpServer())
      .get("/api/auth/me")
      .auth(old.tokens.accessToken, { type: "bearer" })
      .expect(401);
    await expect(auth.refreshToken(old.tokens.refreshToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });

    const socket = io(await app.getUrl(), {
      auth: { token: old.tokens.accessToken },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    try {
      const error = await new Promise<{ code: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket authentication timed out")), 5000);
        socket.once("error", (payload: { code: string }) => {
          clearTimeout(timer);
          resolve(payload);
        });
        socket.once("connect_error", (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      expect(error.code).toBe("UNAUTHORIZED");
    } finally {
      socket.disconnect();
    }

    const current = await auth.login({ identifier: username, password: newPassword });
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .auth(current.tokens.accessToken, { type: "bearer" })
      .expect(200);
  });

  it("disconnects sockets, fails closed and recovers if the PostgreSQL listener is terminated", async () => {
    const login = await auth.login({ identifier: username, password: newPassword });
    const socket = await connectOnOtherNode(login.tokens.accessToken);
    const listener = otherNode.get(AuthRevocationListener);
    const pid = (listener as unknown as { client: { processID: number } }).client.processID;
    const disconnected = new Promise<string>((resolve) => socket.once("disconnect", resolve));

    await db.execute(sql`select pg_terminate_backend(${pid})`);

    expect(await disconnected).toBe("io server disconnect");
    expect(listener.track(userId, uuidv7(), () => {})).toBeNull();
    await vi.waitFor(
      () => {
        const untrack = listener.track(userId, uuidv7(), () => {});
        expect(untrack).not.toBeNull();
        untrack?.();
      },
      { timeout: 10_000, interval: 50 },
    );
    const reconnected = await connectOnOtherNode(login.tokens.accessToken);
    expect(reconnected.connected).toBe(true);
    reconnected.disconnect();
  }, 15_000);
});
