import { INestApplication } from "@nestjs/common";
import { getDrizzleToken } from "@nestjs/drizzle";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { eq, inArray } from "drizzle-orm";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.js";
import { DrizzleDb } from "../../src/configs/database.js";
import { JWT_CONFIG } from "../../src/domain/auth/constants.js";
import type { JwtConfig } from "../../src/domain/auth/jwt.js";
import { conversations } from "../../src/domain/conversation/schema.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";

interface SocketErrorPayload {
  code: string;
  message: string;
}

interface JoinAck {
  success: boolean;
  conversationId: string;
}

interface TypingPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

interface MessageNewPayload {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
}

interface ReadUpdatedPayload {
  userId: string;
  lastReadMessageId: string;
  readAt: string;
}

interface MessageRevokedPayload {
  id: string;
  deletedAt: string;
}

const CONNECT_TIMEOUT_MS = 5000;
const EVENT_TIMEOUT_MS = 5000;
const MESSAGE_FANOUT_WINDOW_MS = 300;
const TYPING_SETTLE_MS = 200;
const TEST_TIMEOUT_MS = 15000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = EVENT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onEvent = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };
    timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}"`));
    }, timeoutMs);
    socket.once(event, onEvent);
  });
}

interface EventCollector<T> {
  events: T[];
  stop: () => void;
}

function collectEvents<T>(socket: Socket, event: string): EventCollector<T> {
  const events: T[] = [];
  const onEvent = (payload: T): void => {
    events.push(payload);
  };
  socket.on(event, onEvent);

  return {
    events,
    stop: (): void => {
      socket.off(event, onEvent);
    },
  };
}

function connectSocket(url: string, token?: string): Promise<Socket> {
  const socket = io(url, {
    ...(token === undefined ? {} : { auth: { token } }),
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });

  return new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timed out after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.once("connect_error", (err: Error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

function joinConversation(socket: Socket, conversationId: string): Promise<JoinAck> {
  return new Promise<JoinAck>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`conv:join ack timed out after ${EVENT_TIMEOUT_MS}ms`));
    }, EVENT_TIMEOUT_MS);

    socket.emit("conv:join", { conversationId }, (ack: JoinAck) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

describe("Realtime chat gateway over socket.io (E2E)", () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let jwtConfig: JwtConfig;
  let url: string;

  const userA = uuidv7();
  const userB = uuidv7();
  const userC = uuidv7();
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let conversationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    app.useGlobalPipes(standardSchemaPipe());
    app.useGlobalFilters(new ErrorFilter());
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    await app.listen(0);
    url = await app.getUrl();

    db = moduleFixture.get<DrizzleDb>(getDrizzleToken());
    jwtConfig = moduleFixture.get<JwtConfig>(JWT_CONFIG);

    const ts = Date.now();
    await db
      .insert(users)
      .values([
        {
          id: userA,
          email: `socket_a_${ts}@lemon.io`,
          username: `socket_a_${ts}`,
          fullName: "Socket Alpha",
        },
        {
          id: userB,
          email: `socket_b_${ts}@lemon.io`,
          username: `socket_b_${ts}`,
          fullName: "Socket Beta",
        },
        {
          id: userC,
          email: `socket_c_${ts}@lemon.io`,
          username: `socket_c_${ts}`,
          fullName: "Socket Outsider",
        },
      ])
      .onConflictDoNothing();

    [tokenA, tokenB, tokenC] = await Promise.all([
      jwtConfig.signAccessToken(userA),
      jwtConfig.signAccessToken(userB),
      jwtConfig.signAccessToken(userC),
    ]);

    const convRes = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ targetUserId: userB })
      .expect(201);

    conversationId = convRes.body.data.id;
  });

  afterAll(async () => {
    try {
      if (db) {
        if (conversationId) {
          await db.delete(conversations).where(eq(conversations.id, conversationId));
        }
        await db.delete(users).where(inArray(users.id, [userA, userB, userC]));
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it(
    "rejects a connection without a token with UNAUTHORIZED and disconnects the client",
    async () => {
      const client = io(url, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });

      try {
        const [error, reason] = await Promise.all([
          waitForEvent<SocketErrorPayload>(client, "error"),
          waitForEvent<string>(client, "disconnect"),
        ]);

        expect(error.code).toBe("UNAUTHORIZED");
        expect(reason).toBe("io server disconnect");
        expect(client.connected).toBe(false);
      } finally {
        client.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acks conv:join with success for a conversation participant",
    async () => {
      const clientA = await connectSocket(url, tokenA);

      try {
        const ack = await joinConversation(clientA, conversationId);

        expect(ack).toEqual({ success: true, conversationId });
      } finally {
        clientA.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects conv:join from an outsider with success false and NOT_PARTICIPANT",
    async () => {
      const clientC = await connectSocket(url, tokenC);

      try {
        const errorPromise = waitForEvent<SocketErrorPayload>(clientC, "error");
        const ack = await joinConversation(clientC, conversationId);
        const error = await errorPromise;

        expect(ack).toEqual({ success: false, conversationId });
        expect(error.code).toBe("NOT_PARTICIPANT");
      } finally {
        clientC.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "broadcasts exactly one message:new to the partner when a message is sent over REST",
    async () => {
      const [clientA, clientB] = await Promise.all([
        connectSocket(url, tokenA),
        connectSocket(url, tokenB),
      ]);

      try {
        await joinConversation(clientA, conversationId);
        await joinConversation(clientB, conversationId);

        const collector = collectEvents<MessageNewPayload>(clientB, "message:new");
        const body = `socket fanout ${Date.now()}`;

        const res = await request(app.getHttpServer())
          .post(`/api/conversations/${conversationId}/messages`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ body })
          .expect(201);

        await delay(MESSAGE_FANOUT_WINDOW_MS);
        collector.stop();

        expect(collector.events).toHaveLength(1);
        expect(collector.events[0].id).toBe(res.body.data.id);
        expect(collector.events[0].body).toBe(body);
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "relays typing:start to the partner without echoing it back to the sender",
    async () => {
      const [clientA, clientB] = await Promise.all([
        connectSocket(url, tokenA),
        connectSocket(url, tokenB),
      ]);

      try {
        await joinConversation(clientA, conversationId);
        await joinConversation(clientB, conversationId);

        const senderCollector = collectEvents<TypingPayload>(clientA, "typing");
        const typingPromise = waitForEvent<TypingPayload>(clientB, "typing");

        clientA.emit("typing:start", { conversationId });

        const typing = await typingPromise;
        expect(typing).toEqual({ conversationId, userId: userA, isTyping: true });

        await delay(TYPING_SETTLE_MS);
        senderCollector.stop();
        expect(senderCollector.events).toHaveLength(0);
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "broadcasts read:updated and message:revoked to the partner",
    async () => {
      const [clientA, clientB] = await Promise.all([
        connectSocket(url, tokenA),
        connectSocket(url, tokenB),
      ]);

      try {
        await joinConversation(clientA, conversationId);
        await joinConversation(clientB, conversationId);

        const sendRes = await request(app.getHttpServer())
          .post(`/api/conversations/${conversationId}/messages`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ body: `socket revoke ${Date.now()}` })
          .expect(201);

        const messageId = sendRes.body.data.id;

        const readPromise = waitForEvent<ReadUpdatedPayload>(clientB, "read:updated");
        await request(app.getHttpServer())
          .post(`/api/conversations/${conversationId}/read`)
          .set("Authorization", `Bearer ${tokenB}`)
          .send({ lastReadMessageId: messageId })
          .expect(200);

        const readUpdated = await readPromise;
        expect(readUpdated).toEqual({
          userId: userB,
          lastReadMessageId: messageId,
          readAt: expect.any(String),
        });

        const revokedPromise = waitForEvent<MessageRevokedPayload>(clientB, "message:revoked");
        await request(app.getHttpServer())
          .delete(`/api/messages/${messageId}`)
          .set("Authorization", `Bearer ${tokenA}`)
          .expect(200);

        const revoked = await revokedPromise;
        expect(revoked).toEqual({ id: messageId, deletedAt: expect.any(String) });
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
