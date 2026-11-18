import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { getDrizzleToken } from "@nestjs/drizzle";
import cookieParser from "cookie-parser";
import { and, eq, inArray } from "drizzle-orm";
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
import { messageHiddenForUsers } from "../../src/domain/message/schema.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";
import { STORAGE_SERVICE, type StorageService } from "../../src/utils/storage/store.js";

describe("Group conversations with PostgreSQL and Redis", () => {
  let app: INestApplication;
  let db: DrizzleDb;
  const creatorId = uuidv7();
  const memberId = uuidv7();
  const secondMemberId = uuidv7();
  const lateMemberId = uuidv7();
  const userIds = [creatorId, memberId, secondMemberId, lateMemberId];
  const tokens = new Map<string, string>();
  let conversationId: string;

  beforeAll(async () => {
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    const storage: StorageService = {
      getBucket: () => "test-bucket",
      presignPut: async ({ objectKey }) => ({ uploadUrl: `https://storage.local/${objectKey}` }),
      presignGet: async ({ objectKey }) => ({ downloadUrl: `https://storage.local/${objectKey}` }),
      headObject: async (key) => {
        const o = objects.get(key);
        return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
      },
      getObject: async (key) => {
        const o = objects.get(key);
        return o
          ? {
              body: new Uint8Array(o.body),
              contentLength: o.body.length,
              contentType: o.contentType,
            }
          : null;
      },
      putObject: async ({ objectKey, body, mimeType }) => {
        objects.set(objectKey, { body: Buffer.from(body), contentType: mimeType });
      },
      deleteObjects: async (keys) => {
        for (const key of keys) objects.delete(key);
        return { deleted: keys, failed: [] };
      },
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_SERVICE)
      .useValue(storage)
      .compile();
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
    await Promise.all(
      userIds.map(async (id) => tokens.set(id, await jwt.signAccessToken(id, 0, id))),
    );
  }, 30000);

  afterAll(async () => {
    try {
      if (db) {
        await db.delete(conversations).where(eq(conversations.creatorId, creatorId));
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
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "  Project group  ", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    conversationId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      kind: "GROUP",
      title: "Project group",
      memberCount: 3,
      myRole: "ADMIN",
    });

    const retry = await request(app.getHttpServer())
      .post("/api/conversations/groups")
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "Project group", memberIds: [memberId, secondMemberId], clientRequestId })
      .expect(201);
    expect(retry.body.data.id).toBe(conversationId);

    const beforeJoin = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ body: "Before joining", clientMsgId: uuidv7() })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/members`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ memberIds: [lateMemberId] })
      .expect(201);
    const hiddenHistory = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(200);
    expect(hiddenHistory.body.data.items).toHaveLength(0);

    await request(app.getHttpServer())
      .delete(`/api/messages/${beforeJoin.body.data.id}/for-me`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(404);

    const afterJoin = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ body: "After joining", clientMsgId: uuidv7() })
      .expect(201);
    const visibleHistory = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(200);
    expect(visibleHistory.body.data.items.map((message: { body: string }) => message.body)).toEqual(
      ["After joining"],
    );
    const [beforeHide] = await db
      .select({ unreadRevision: conversations.unreadRevision })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .delete(`/api/messages/${afterJoin.body.data.id}/for-me`)
          .auth(tokens.get(lateMemberId)!, { type: "bearer" })
          .expect(204),
      ),
    );
    const [afterHide] = await db
      .select({ unreadRevision: conversations.unreadRevision })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(afterHide.unreadRevision).toBe(beforeHide.unreadRevision + 1n);
    const hiddenRows = await db
      .select({ messageId: messageHiddenForUsers.messageId })
      .from(messageHiddenForUsers)
      .where(
        and(
          eq(messageHiddenForUsers.messageId, afterJoin.body.data.id),
          eq(messageHiddenForUsers.userId, lateMemberId),
        ),
      );
    expect(hiddenRows).toHaveLength(1);
    const hiddenForLateMember = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(200);
    expect(hiddenForLateMember.body.data.items).toHaveLength(0);

    await db
      .update(friendships)
      .set({ status: "BLOCKED" })
      .where(
        and(
          eq(friendships.userLow, [creatorId, memberId].sort()[0]),
          eq(friendships.userHigh, [creatorId, memberId].sort()[1]),
        ),
      );
    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ body: "Still in the group", clientMsgId: uuidv7() })
      .expect(201);

    // Member cannot upload group avatar
    await request(app.getHttpServer())
      .post(`/api/files/group-avatars/${conversationId}/upload`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "avatar.png")
      .expect(403);

    // Admin can upload group avatar
    const uploadRes = await request(app.getHttpServer())
      .post(`/api/files/group-avatars/${conversationId}/upload`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "avatar.png")
      .expect(200);
    expect(uploadRes.body.data.avatarUrl).toContain(`/api/files/group-avatars/${conversationId}/`);
    const avatarPath = new URL(uploadRes.body.data.avatarUrl).pathname;

    // Unauthenticated cannot download private group avatar
    await request(app.getHttpServer()).get(avatarPath).expect(401);

    // Member can download group avatar with private, no-store Cache-Control
    const avatarRes = await request(app.getHttpServer())
      .get(avatarPath)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .expect(200);
    expect(avatarRes.headers["cache-control"]).toBe("private, no-store");

    // Member cannot rename group
    await request(app.getHttpServer())
      .patch(`/api/conversations/${conversationId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .send({ title: "Renamed by member" })
      .expect(403);

    // Admin can rename group
    await request(app.getHttpServer())
      .patch(`/api/conversations/${conversationId}`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ title: "Renamed by admin" })
      .expect(200);

    const lastAdminLeave = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/leave`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .expect(409);
    expect(lastAdminLeave.body.code).toBe("LAST_ADMIN_REQUIRED");
    await request(app.getHttpServer())
      .patch(`/api/conversations/${conversationId}/members/${memberId}/role`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ role: "ADMIN" })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/conversations/${conversationId}/members/${lateMemberId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/messages/${afterJoin.body.data.id}/for-me`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/members`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .send({ memberIds: [lateMemberId] })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/messages/${afterJoin.body.data.id}/for-me`)
      .auth(tokens.get(lateMemberId)!, { type: "bearer" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/conversations/${conversationId}/members/${lateMemberId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .expect(204);

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/leave`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .auth(tokens.get(creatorId)!, { type: "bearer" })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/conversations/${conversationId}`)
      .auth(tokens.get(memberId)!, { type: "bearer" })
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .auth(tokens.get(secondMemberId)!, { type: "bearer" })
      .expect(404);
  }, 60000);
});
