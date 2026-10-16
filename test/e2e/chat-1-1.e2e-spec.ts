import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.js";
import { DrizzleDb } from "../../src/configs/database.js";
import { users } from "../../src/domain/user/schema.js";
import { GlobalErrorFilter } from "../../src/utils/error-filter.js";
import { v7 as uuidv7 } from "uuid";
import { eq, inArray } from "drizzle-orm";
import { conversations } from "../../src/domain/conversation/schema.js";

import { getDrizzleToken } from "@nestjs/drizzle";

describe("Direct Chat 1-1 (E2E)", () => {
  let app: INestApplication;
  let db: DrizzleDb;

  const userA = uuidv7();
  const userB = uuidv7();
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new GlobalErrorFilter());
    await app.init();

    db = moduleFixture.get<DrizzleDb>(getDrizzleToken());

    const ts = Date.now();
    // Insert 2 mock users into Neon DB for foreign key compliance
    await db
      .insert(users)
      .values([
        { id: userA, email: `test_a_${ts}@lemon.io`, username: `user_a_${ts}`, fullName: "User Alpha" },
        { id: userB, email: `test_b_${ts}@lemon.io`, username: `user_b_${ts}`, fullName: "User Beta" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup created conversation and users
    if (conversationId) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
    }
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await app.close();
  });

  it("POST /api/conversations/direct - should create or get a direct conversation", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("x-user-id", userA)
      .send({ targetUserId: userB })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.kind).toBe("DIRECT");
    expect(res.body.data.partner.id).toBe(userB);

    conversationId = res.body.data.id;
  });

  it("POST /api/conversations/direct - idempotent: calling again returns the same conversation", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("x-user-id", userA)
      .send({ targetUserId: userB })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(conversationId);
  });

  it("GET /api/conversations - should list conversations in inbox", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/conversations")
      .set("x-user-id", userA)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((c: any) => c.id === conversationId);
    expect(found).toBeDefined();
  });

  it("POST /api/conversations/:id/messages - should send a message", async () => {
    const clientMsgId = `client-${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .send({
        body: "Xin chao tu User Alpha!",
        clientMsgId,
        kind: "TEXT",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe("Xin chao tu User Alpha!");
    expect(res.body.data.senderId).toBe(userA);

    messageId = res.body.data.id;

    // Test idempotency with clientMsgId
    const retryRes = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .send({
        body: "Xin chao tu User Alpha!",
        clientMsgId,
        kind: "TEXT",
      })
      .expect(201);

    expect(retryRes.body.data.id).toBe(messageId);
  });

  it("GET /api/conversations/:id/messages - should get message timeline", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toBeDefined();
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0].id).toBe(messageId);
  });

  it("PATCH /api/messages/:id - should edit own message", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${messageId}`)
      .set("x-user-id", userA)
      .send({ body: "Noi dung da duoc chinh sua!" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe("Noi dung da duoc chinh sua!");
    expect(res.body.data.editedAt).not.toBeNull();
  });

  it("POST /api/conversations/:id/read - should mark conversation as read", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/read`)
      .set("x-user-id", userB)
      .send({ lastReadMessageId: messageId })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it("DELETE /api/messages/:id - should revoke message", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/messages/${messageId}`)
      .set("x-user-id", userA)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deletedAt).not.toBeNull();
  });

  // --- EDGE CASES & SECURITY TESTS ---

  it("POST /api/conversations/direct - should reject self-chat with 400 CANNOT_CHAT_WITH_SELF", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("x-user-id", userA)
      .send({ targetUserId: userA })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("CANNOT_CHAT_WITH_SELF");
  });

  it("POST /api/conversations/direct - should return 404 USER_NOT_FOUND if target user doesn't exist", async () => {
    const nonExistent = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("x-user-id", userA)
      .send({ targetUserId: nonExistent })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("GET /api/conversations/:id/messages - should reject unauthorized non-member with 403 NOT_PARTICIPANT", async () => {
    const outsider = uuidv7();
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", outsider)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("NOT_PARTICIPANT");
  });

  it("POST /api/conversations/:id/messages - should reject empty text message with 400 BAD_REQUEST", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .send({ body: "   " })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("POST /api/conversations/:id/messages - should reject message longer than 4000 chars with 400 BAD_REQUEST", async () => {
    const longBody = "a".repeat(4001);
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .send({ body: longBody })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("PATCH /api/messages/:id - should return 400 MESSAGE_REVOKED if message was already revoked", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${messageId}`)
      .set("x-user-id", userA)
      .send({ body: "Thử sửa tin đã thu hồi" })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("MESSAGE_REVOKED");
  });

  it("DELETE /api/messages/:id - should return 400 MESSAGE_REVOKED if revoked again", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/messages/${messageId}`)
      .set("x-user-id", userA)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("MESSAGE_REVOKED");
  });

  it("PATCH /api/messages/:id - should reject editing by someone who is not the sender with 403 FORBIDDEN", async () => {
    // Send a fresh message from userA
    const sendRes = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("x-user-id", userA)
      .send({ body: "Tin nhắn của User A" })
      .expect(201);

    const freshMsgId = sendRes.body.data.id;

    // User B tries to edit User A's message
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${freshMsgId}`)
      .set("x-user-id", userB)
      .send({ body: "User B muốn sửa tin này" })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});
