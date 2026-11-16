import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { getDrizzleToken } from "@nestjs/drizzle";
import cookieParser from "cookie-parser";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.js";
import type { DrizzleDb } from "../../src/configs/database.js";
import { REFRESH_TOKEN_EXPIRATION } from "../../src/utils/cache/constants.js";
import { JWT_CONFIG } from "../../src/domain/auth/constants.js";
import type { JwtConfig } from "../../src/domain/auth/jwt.js";
import { authSessions } from "../../src/domain/auth/schema.js";
import { conversations } from "../../src/domain/conversation/schema.js";
import { friendships } from "../../src/domain/friend/schema.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";

describe("Group conversations with PostgreSQL and Redis", () => {
  let app: INestApplication;
  let db: DrizzleDb;
  const ownerId = uuidv7();
  const memberId = uuidv7();
  const secondMemberId = uuidv7();
  const lateMemberId = uuidv7();
  const userIds = [ownerId, memberId, secondMemberId, lateMemberId];
  const tokens = new Map<string, string>();
  let conversationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.use(cookieParser());
    app.useGlobalPipes(standardSchemaPipe());
    app.useGlobalFilters(new ErrorFilter());
    await app.init();
    db = module.get<DrizzleDb>(getDrizzleToken());
    const jwt = module.get<JwtConfig>(JWT_CONFIG);
    const unique = Date.now().toString();

    await db.insert(users).values(
      userIds.map((id, index) => ({
        id,
        email: `group${unique}${index}@example.test`,
        username: `group${unique}${index}`,
        fullName: `Group Test ${index}`,
      })),
    );
    await db.insert(authSessions).values(
      userIds.map((id) => ({
        id,
        userId: id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
      })),
    );
    const friendIds = [memberId, secondMemberId, lateMemberId];
    await db.insert(friendships).values(
      friendIds.map((friendId) => {
        const [userLow, userHigh] = [ownerId, friendId].sort();
        return {
          requesterId: ownerId,
          addresseeId: friendId,
          userLow,
          userHigh,
          status: "ACCEPTED" as const,
        };
      }),
    );
    await Promise.all(
      userIds.map(async (id) => tokens.set(id, await jwt.signAccessToken(id, 0, id))),
    );
  }, 30000);

  afterAll(async () => {
    try {
      if (db) {
        await db.delete(conversations).where(eq(conversations.creatorId, ownerId));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally {
      if (app) await app.close();
    }
  });

  it("creates a group, enforces history boundaries, preserves group chat across blocks, and applies roles/removal", async () => {
    const clientRequestId = uuidv7();
    const created = await request(app.getHttpServer())
      .post("/api/conversations/groups")
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ title: "  Project group  ", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    conversationId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      kind: "GROUP",
      title: "Project group",
      memberCount: 3,
      myRole: "OWNER",
    });

    const retry = await request(app.getHttpServer())
      .post("/api/conversations/groups")
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ title: "Project group", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    expect(retry.body.data.id).toBe(conversationId);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ body: "Before joining" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/members`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ memberIds: [lateMemberId] })
      .expect(201);
    const hiddenHistory = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(200);
    expect(hiddenHistory.body.data.items).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ body: "After joining" })
      .expect(201);
    const visibleHistory = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(200);
    expect(visibleHistory.body.data.items.map((message: { body: string }) => message.body)).toEqual(
      ["After joining"],
    );

    await db
      .update(friendships)
      .set({ status: "BLOCKED" })
      .where(eq(friendships.userLow, [ownerId, memberId].sort()[0]));
    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ body: "Still in the group" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/conversations/${conversationId}/members/${memberId}/role`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ role: "ADMIN" })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/conversations/${conversationId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ title: "Renamed by admin" })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/transfer-ownership`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .send({ userId: memberId })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/conversations/${conversationId}/members/${lateMemberId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/leave`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .auth(tokens.get(ownerId)!, { type: "bearer" })
      .expect(403);
  }, 60000);
});
