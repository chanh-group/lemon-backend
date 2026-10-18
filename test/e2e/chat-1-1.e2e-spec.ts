import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.js";
import { DrizzleDb } from "../../src/configs/database.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";
import cookieParser from "cookie-parser";
import { v7 as uuidv7 } from "uuid";
import { eq, inArray } from "drizzle-orm";
import { conversations } from "../../src/domain/conversation/schema.js";
import { getDrizzleToken } from "@nestjs/drizzle";
import { JWT_CONFIG } from "../../src/domain/auth/constants.js";
import type { JwtConfig } from "../../src/domain/auth/jwt.js";

describe("Direct Chat 1-1 with Real JWT Auth (E2E)", () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let jwtConfig: JwtConfig;

  const userA = uuidv7();
  const userB = uuidv7();
  let tokenA: string;
  let tokenB: string;

  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    app.useGlobalPipes(standardSchemaPipe());
    app.useGlobalFilters(new ErrorFilter());
    await app.init();

    db = moduleFixture.get<DrizzleDb>(getDrizzleToken());
    jwtConfig = moduleFixture.get<JwtConfig>(JWT_CONFIG);

    tokenA = await jwtConfig.signAccessToken(userA);
    tokenB = await jwtConfig.signAccessToken(userB);

    const ts = Date.now();
    // Insert 2 mock users into Neon DB for foreign key compliance
    await db
      .insert(users)
      .values([
        {
          id: userA,
          email: `test_a_${ts}@lemon.io`,
          username: `user_a_${ts}`,
          fullName: "User Alpha",
        },
        {
          id: userB,
          email: `test_b_${ts}@lemon.io`,
          username: `user_b_${ts}`,
          fullName: "User Beta",
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (conversationId) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
    }
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await app.close();
  });

  // --- SECURITY TESTS (ZERO TRUST / NO x-user-id) ---

  it("POST /api/conversations/direct - should reject request without Authorization header with 401 UNAUTHORIZED", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .send({ targetUserId: userB })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/conversations/direct - should reject spoofed x-user-id header without valid JWT with 401 UNAUTHORIZED", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("x-user-id", userA)
      .send({ targetUserId: userB })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/conversations/direct - should reject invalid JWT token with 401 UNAUTHORIZED", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", "Bearer invalid-jwt-token")
      .send({ targetUserId: userB })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/conversations/direct - should reject Refresh Token used as Bearer token with 401 UNAUTHORIZED", async () => {
    const refreshToken = await jwtConfig.signRefreshToken(userA, uuidv7());
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${refreshToken}`)
      .send({ targetUserId: userB })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("GET /api/conversations/:id - should reject non-UUID route param with 400 Bad Request", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/conversations/invalid-not-uuid")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  // --- CHAT 1-1 CORE FLOW WITH JWT BEARER TOKENS ---

  it("POST /api/conversations/direct - should create or get a direct conversation with Bearer token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${tokenA}`)
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
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ targetUserId: userB })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(conversationId);
  });

  it("GET /api/conversations - should list conversations in inbox", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/conversations")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((c: any) => c.id === conversationId);
    expect(found).toBeDefined();
  });

  it("POST /api/conversations/:id/messages - should send a message with Bearer token", async () => {
    const clientMsgId = uuidv7();
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        body: "Xin chao tu User Alpha qua JWT!",
        clientMsgId,
        kind: "TEXT",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe("Xin chao tu User Alpha qua JWT!");
    expect(res.body.data.senderId).toBe(userA);

    messageId = res.body.data.id;

    // Test idempotency with clientMsgId
    const retryRes = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        body: "Xin chao tu User Alpha qua JWT!",
        clientMsgId,
        kind: "TEXT",
      })
      .expect(201);

    expect(retryRes.body.data.id).toBe(messageId);
  });

  it("POST /api/conversations/:id/messages - should safely store and return HTML/XSS body without corruption", async () => {
    const xssPayload = "<script>alert('xss')</script>";
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        body: xssPayload,
        kind: "TEXT",
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe(xssPayload);
  });

  it("GET /api/conversations/:id/messages - should get message timeline", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toBeDefined();
    expect(res.body.data.items.length).toBeGreaterThan(0);
    const ids = res.body.data.items.map((m: any) => m.id);
    expect(ids).toContain(messageId);
  });

  it("PATCH /api/messages/:id - should edit own message with Bearer token", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Noi dung da duoc chinh sua voi JWT!" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe("Noi dung da duoc chinh sua voi JWT!");
    expect(res.body.data.editedAt).not.toBeNull();
  });

  it("POST /api/conversations/:id/read - should mark conversation as read with Bearer token B", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/read`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ lastReadMessageId: messageId })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it("DELETE /api/messages/:id - should revoke message with Bearer token", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deletedAt).not.toBeNull();
  });

  // --- EDGE CASES & AUTHORIZATION TESTS ---

  it("POST /api/conversations/direct - should reject self-chat with 400 CANNOT_CHAT_WITH_SELF", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ targetUserId: userA })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("CANNOT_CHAT_WITH_SELF");
  });

  it("POST /api/conversations/direct - should return 404 USER_NOT_FOUND if target user doesn't exist", async () => {
    const nonExistent = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ targetUserId: nonExistent })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("GET /api/conversations/:id/messages - should reject unauthorized non-member with 403 NOT_PARTICIPANT", async () => {
    const outsider = uuidv7();
    const tokenOutsider = await jwtConfig.signAccessToken(outsider);

    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenOutsider}`)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("NOT_PARTICIPANT");
  });

  it("POST /api/conversations/:id/messages - should reject empty text message with 422 VALIDATION_ERROR", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "   " })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/conversations/:id/messages - should reject message longer than 4000 chars with 422 VALIDATION_ERROR", async () => {
    const longBody = "a".repeat(4001);
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: longBody })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /api/messages/:id - should return 400 MESSAGE_REVOKED if message was already revoked", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Thử sửa tin đã thu hồi" })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("MESSAGE_REVOKED");
  });

  it("DELETE /api/messages/:id - should return 400 MESSAGE_REVOKED if revoked again", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("MESSAGE_REVOKED");
  });

  it("PATCH /api/messages/:id - should reject editing by someone who is not the sender with 403 FORBIDDEN", async () => {
    // Send a fresh message from userA
    const sendRes = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Tin nhắn của User A" })
      .expect(201);

    const freshMsgId = sendRes.body.data.id;

    // User B tries to edit User A's message
    const res = await request(app.getHttpServer())
      .patch(`/api/messages/${freshMsgId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ body: "User B muốn sửa tin này" })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("POST /api/conversations/direct - should reject invalid targetUserId format with 422 VALIDATION_ERROR", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/conversations/direct")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ targetUserId: "not-a-valid-uuid" })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/conversations/:id/read - should reject invalid lastReadMessageId format with 422 VALIDATION_ERROR", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/read`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ lastReadMessageId: "invalid-uuid" })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/conversations/:id/messages - clientMsgId idempotency returns existing message", async () => {
    const uniqueClientMsgId = uuidv7();
    const res1 = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Tin nhắn idempotent", clientMsgId: uniqueClientMsgId })
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Tin nhắn idempotent", clientMsgId: uniqueClientMsgId })
      .expect(201);

    expect(res1.body.data.id).toBe(res2.body.data.id);
  });

  it("DELETE /api/messages/:id - should update conversation lastMessagePreview to 'Tin nhắn đã bị thu hồi'", async () => {
    const sendRes = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ body: "Tin nhắn sắp bị thu hồi" })
      .expect(201);

    const targetMsgId = sendRes.body.data.id;

    // Revoke the message
    await request(app.getHttpServer())
      .delete(`/api/messages/${targetMsgId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    // Verify conversation inbox preview
    const convRes = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    expect(convRes.body.data.lastMessagePreview).toBe("Tin nhắn đã bị thu hồi");
  });
});
