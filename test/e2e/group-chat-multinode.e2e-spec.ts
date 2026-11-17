import type { INestApplication } from "@nestjs/common";
import { getDrizzleToken } from "@nestjs/drizzle";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { eq, inArray } from "drizzle-orm";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.js";
import type { DrizzleDb } from "../../src/configs/database.js";
import { RedisIoAdapter } from "../../src/configs/socket-adapter.js";
import { JWT_CONFIG } from "../../src/domain/auth/constants.js";
import type { JwtConfig } from "../../src/domain/auth/jwt.js";
import { authSessions } from "../../src/domain/auth/schema.js";
import { conversations } from "../../src/domain/conversation/schema.js";
import { friendships } from "../../src/domain/friend/schema.js";
import { users } from "../../src/domain/user/schema.js";
import { ChatGateway } from "../../src/domain/realtime/chat.gateway.js";
import { convRoom } from "../../src/domain/realtime/rooms.js";
import { REFRESH_TOKEN_EXPIRATION } from "../../src/utils/cache/constants.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";

type MessageEvent = {
  id: string;
  conversationId: string;
  body: string | null;
  replyTarget?: { body?: string | null } | null;
};

function once<T>(socket: Socket, event: string, stage: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event} (${stage})`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

async function connect(url: string, token: string): Promise<Socket> {
  const socket = io(url, {
    auth: { token },
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error("Socket connection timed out"));
    }, 15000);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      socket.disconnect();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
  return socket;
}

describe("Group chat across two Redis adapter nodes", () => {
  const creatorId = uuidv7();
  const memberId = uuidv7();
  const secondMemberId = uuidv7();
  const lateMemberId = uuidv7();
  const userIds = [creatorId, memberId, secondMemberId, lateMemberId];
  const sockets: Socket[] = [];
  const apps: INestApplication[] = [];
  const adapters: RedisIoAdapter[] = [];
  const tokens = new Map<string, string>();
  let db: DrizzleDb;
  let nodeA: INestApplication;
  let nodeB: INestApplication;
  let gatewayB: ChatGateway;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = module.createNestApplication();
      apps.push(app);
      app.setGlobalPrefix("api");
      app.use(cookieParser());
      app.useGlobalPipes(standardSchemaPipe());
      app.useGlobalFilters(new ErrorFilter());
      const adapter = new RedisIoAdapter(app);
      adapters.push(adapter);
      await adapter.connectToRedis();
      app.useWebSocketAdapter(adapter);
      await app.init();
      await app.listen(0);
      if (i === 0) {
        nodeA = app;
        db = module.get<DrizzleDb>(getDrizzleToken());
        const jwt = module.get<JwtConfig>(JWT_CONFIG);
        await Promise.all(
          userIds.map(async (id) => tokens.set(id, await jwt.signAccessToken(id, 0, id))),
        );
      } else {
        nodeB = app;
        gatewayB = module.get(ChatGateway);
      }
    }

    const unique = Date.now().toString();
    await db.insert(users).values(
      userIds.map((id, index) => ({
        id,
        email: `group_multinode_${unique}_${index}@example.test`,
        username: `multinode${unique}${index}`,
        fullName: `Multi Node ${index}`,
      })),
    );
    await db.insert(authSessions).values(
      userIds.map((id) => ({
        id,
        userId: id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
      })),
    );
    await db.insert(friendships).values(
      [memberId, secondMemberId, lateMemberId].map((friendId) => {
        const [userLow, userHigh] = [creatorId, friendId].sort();
        return {
          requesterId: creatorId,
          addresseeId: friendId,
          userLow,
          userHigh,
          status: "ACCEPTED" as const,
        };
      }),
    );
  }, 90000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    try {
      if (db) {
        await db.delete(conversations).where(eq(conversations.creatorId, creatorId));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally {
      await Promise.allSettled(apps.map((app) => app.close()));
      await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
    }
  }, 90000);

  it("filters historical reply content and keeps a removed user out after idempotent retry", async () => {
    const clientRequestId = uuidv7();
    const lateSocket = await connect(await nodeB.getUrl(), tokens.get(lateMemberId)!);
    sockets.push(lateSocket);
    const memberSocket = await connect(await nodeB.getUrl(), tokens.get(memberId)!);
    sockets.push(memberSocket);
    const creatorSocket = await connect(await nodeA.getUrl(), tokens.get(creatorId)!);
    sockets.push(creatorSocket);

    const created = await request(nodeA.getHttpServer())
      .post("/api/conversations/groups")
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "Two node group", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    const conversationId: string = created.body.data.id;
    const joined = await new Promise<{ success: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("conv:join timed out")), 15000);
      memberSocket.emit("conv:join", { conversationId }, (ack: { success: boolean }) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
    expect(joined.success).toBe(true);
    expect(
      gatewayB.server.sockets.adapter.rooms.get(convRoom(conversationId))?.has(memberSocket.id!),
    ).toBe(true);

    const old = await request(nodeA.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ body: "secret before join" })
      .expect(201);

    await request(nodeA.getHttpServer())
      .post(`/api/conversations/${conversationId}/members`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ memberIds: [lateMemberId] })
      .expect(201);

    const lateReply = once<MessageEvent>(lateSocket, "message:new", "late member receives reply");
    await request(nodeA.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ body: "reply after join", replyToId: old.body.data.id })
      .expect(201);
    const received = await lateReply;
    expect(received.body).toBe("reply after join");
    expect(received.replyTarget).toBeNull();

    // Force leave-before-join on different Redis adapter nodes.
    const serverSocket = gatewayB.server.sockets.sockets.get(lateSocket.id!);
    expect(serverSocket).toBeDefined();
    const originalJoin = serverSocket!.join.bind(serverSocket);
    let markJoinStarted!: () => void;
    let resumeJoin!: () => void;
    const joinStarted = new Promise<void>((resolve) => {
      markJoinStarted = resolve;
    });
    const joinGate = new Promise<void>((resolve) => {
      resumeJoin = resolve;
    });
    const joinSpy = vi.spyOn(serverSocket!, "join").mockImplementation(async (rooms) => {
      if (rooms === convRoom(conversationId)) {
        markJoinStarted();
        await joinGate;
      }
      await originalJoin(rooms);
    });
    const joinAck = new Promise<{ success: boolean }>((resolve) => {
      lateSocket.emit("conv:join", { conversationId }, resolve);
    });
    try {
      await joinStarted;
      const lateRemoved = once<{ conversationId: string; userId: string }>(
        lateSocket,
        "member:removed",
        "late member removal",
      );
      await request(nodeA.getHttpServer())
        .delete(`/api/conversations/${conversationId}/members/${lateMemberId}`)
        .auth(tokens.get(creatorId)!, { type: "bearer" })
        .expect(204);
      expect(await lateRemoved).toMatchObject({ conversationId, userId: lateMemberId });
      resumeJoin();
      expect(await joinAck).toMatchObject({ success: false });
      expect(
        gatewayB.server.sockets.adapter.rooms.get(convRoom(conversationId))?.has(lateSocket.id!) ??
          false,
      ).toBe(false);
    } finally {
      resumeJoin();
      joinSpy.mockRestore();
    }

    const removed = once<{ conversationId: string; userId: string }>(
      memberSocket,
      "member:removed",
      "member removal",
    );
    await request(nodeA.getHttpServer())
      .delete(`/api/conversations/${conversationId}/members/${memberId}`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .expect(204);
    expect(await removed).toMatchObject({ conversationId, userId: memberId });
    await expect
      .poll(
        () =>
          gatewayB.server.sockets.adapter.rooms
            .get(convRoom(conversationId))
            ?.has(memberSocket.id!) ?? false,
        { timeout: 10000, interval: 100 },
      )
      .toBe(false);

    await request(nodeA.getHttpServer())
      .patch(`/api/conversations/${conversationId}`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "Renamed two node group" })
      .expect(200);

    const repeatedCreates: unknown[] = [];
    const onCreated = (event: unknown) => repeatedCreates.push(event);
    memberSocket.on("conversation:created", onCreated);
    const replay = await request(nodeA.getHttpServer())
      .post("/api/conversations/groups")
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "Two node group", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    expect(replay.body.data.id).toBe(conversationId);
    expect(replay.body.data.title).toBe("Renamed two node group");

    await new Promise((resolve) => setTimeout(resolve, 500));
    memberSocket.off("conversation:created", onCreated);
    expect(repeatedCreates).toEqual([]);
    expect(
      gatewayB.server.sockets.adapter.rooms.get(convRoom(conversationId))?.has(memberSocket.id!) ??
        false,
    ).toBe(false);

    const removedMessages: MessageEvent[] = [];
    const onRemovedMessage = (message: MessageEvent) => removedMessages.push(message);
    memberSocket.on("message:new", onRemovedMessage);
    try {
      const creatorMessage = once<MessageEvent>(
        creatorSocket,
        "message:new",
        "creator after removal",
      );
      await request(nodeA.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .auth(tokens.get(creatorId)!, { type: "bearer" })
        .send({ body: "after removal" })
        .expect(201);
      expect((await creatorMessage).body).toBe("after removal");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(removedMessages).toEqual([]);
    } finally {
      memberSocket.off("message:new", onRemovedMessage);
    }
  }, 90000);
});
