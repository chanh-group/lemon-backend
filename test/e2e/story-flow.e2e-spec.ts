import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getDrizzleToken } from "@nestjs/drizzle";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.js";
import type { DrizzleDb } from "../../src/configs/database.js";
import { JWT_CONFIG } from "../../src/domain/auth/constants.js";
import type { JwtConfig } from "../../src/domain/auth/jwt.js";
import { authSessions } from "../../src/domain/auth/schema.js";
import { REFRESH_TOKEN_EXPIRATION } from "../../src/utils/cache/constants.js";
import { conversationParticipants, conversations } from "../../src/domain/conversation/schema.js";
import { friendships } from "../../src/domain/friend/schema.js";
import { users } from "../../src/domain/user/schema.js";
import { ErrorFilter } from "../../src/middleware/error-filter.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";
import { STORAGE_SERVICE, type StorageService } from "../../src/utils/storage/store.js";
import { STORY_REPOSITORY, type StoryRepository } from "../../src/domain/story/repository.js";
import { stories } from "../../src/domain/story/schema.js";
import { PurgeJob } from "../../src/jobs/purge/job.js";
import { NOTE_REPOSITORY, type NoteRepository } from "../../src/domain/note/repository.js";

describe("Story flows with PostgreSQL and Redis", () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let server: Server;
  let storageUrl: string;
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const owner = uuidv7(),
    friend = uuidv7(),
    secondFriend = uuidv7(),
    stranger = uuidv7();
  let ownerToken: string, friendToken: string, secondFriendToken: string, strangerToken: string;
  let textId: string, mediaId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const key = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname.slice(1));
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          objects.set(key, {
            body: Buffer.concat(chunks),
            contentType: String(req.headers["content-type"]),
          });
          res.writeHead(200).end();
        });
      } else if (req.method === "GET" && objects.has(key)) {
        const object = objects.get(key)!;
        res.writeHead(200, { "Content-Type": object.contentType }).end(object.body);
      } else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    storageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const storage: StorageService = {
      getBucket: () => "test-bucket",
      presignPut: async ({ objectKey }) => ({
        uploadUrl: `${storageUrl}/${encodeURIComponent(objectKey)}`,
      }),
      presignGet: async ({ objectKey }) => ({
        downloadUrl: `${storageUrl}/${encodeURIComponent(objectKey)}`,
      }),
      headObject: async (key) => {
        const o = objects.get(key);
        return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
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
    app.useGlobalPipes(standardSchemaPipe());
    app.useGlobalFilters(new ErrorFilter());
    await app.init();
    db = module.get<DrizzleDb>(getDrizzleToken());
    const jwt = module.get<JwtConfig>(JWT_CONFIG);
    [ownerToken, friendToken, secondFriendToken, strangerToken] = await Promise.all(
      [owner, friend, secondFriend, stranger].map((id) => jwt.signAccessToken(id, 0, id)),
    );
    const unique = Date.now().toString();
    await db.insert(users).values(
      [owner, friend, secondFriend, stranger].map((id, i) => ({
        id,
        email: `story${unique}${i}@example.test`,
        username: `story${unique}${i}`,
        fullName: `Story Test ${i}`,
      })),
    );
    await db.insert(authSessions).values(
      [owner, friend, secondFriend, stranger].map((id) => ({
        id,
        userId: id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
      })),
    );
    const [userLow, userHigh] = [owner, friend].sort();
    await db.insert(friendships).values([
      { requesterId: owner, addresseeId: friend, userLow, userHigh, status: "ACCEPTED" },
      {
        requesterId: owner,
        addresseeId: secondFriend,
        userLow: [owner, secondFriend].sort()[0],
        userHigh: [owner, secondFriend].sort()[1],
        status: "ACCEPTED",
      },
    ]);
  }, 30000);

  afterAll(async () => {
    try {
      if (db) {
        const testUserIds = [owner, friend, secondFriend, stranger];
        const ownedConversations = db
          .select({ id: conversationParticipants.conversationId })
          .from(conversationParticipants)
          .where(inArray(conversationParticipants.userId, testUserIds));
        await db.delete(conversations).where(inArray(conversations.id, ownedConversations));
        await db.delete(users).where(inArray(users.id, testUserIds));
      }
    } finally {
      if (app) await app.close();
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("creates, views, edits, reacts, replies and deletes a text story", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/stories")
      .auth(ownerToken, { type: "bearer" })
      .send({ kind: "TEXT", caption: "Initial" })
      .expect(201);
    textId = created.body.data.id;
    const feed = await request(app.getHttpServer())
      .get("/api/stories/feed")
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    expect(
      feed.body.data
        .flatMap((group: { stories: { id: string }[] }) => group.stories)
        .some((s: { id: string }) => s.id === textId),
    ).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/stories/${textId}/view`)
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    const viewers = await request(app.getHttpServer())
      .get(`/api/stories/${textId}/views`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(viewers.body.data.totalViewsCount).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/stories/${textId}`)
      .auth(friendToken, { type: "bearer" })
      .send({ caption: "not mine" })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/stories/${textId}`)
      .auth(ownerToken, { type: "bearer" })
      .send({ caption: "Edited" })
      .expect(200);
    const detail = await request(app.getHttpServer())
      .get(`/api/stories/${textId}`)
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    expect(detail.body.data.caption).toBe("Edited");
    await request(app.getHttpServer())
      .post(`/api/stories/${textId}/react`)
      .auth(friendToken, { type: "bearer" })
      .send({ emoji: "👍" })
      .expect(200);
    const reactions = await request(app.getHttpServer())
      .get(`/api/stories/${textId}/reactions`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(reactions.body.data).toMatchObject({
      totalCount: 1,
      summary: [{ emoji: "👍", count: 1 }],
    });

    expect(reactions.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ id: friend }),
          emoji: "👍",
          kind: "REACTION",
        }),
      ]),
    );
    await request(app.getHttpServer())
      .post(`/api/stories/${textId}/react`)
      .auth(secondFriendToken, { type: "bearer" })
      .send({ emoji: "🥰" })
      .expect(200);
    const firstPage = await request(app.getHttpServer())
      .get(`/api/stories/${textId}/reactions?limit=1`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(firstPage.body.data).toMatchObject({
      totalCount: 2,
      hasMore: true,
      summary: expect.arrayContaining([
        { emoji: "👍", count: 1 },
        { emoji: "🥰", count: 1 },
      ]),
    });
    const secondPage = await request(app.getHttpServer())
      .get(
        `/api/stories/${textId}/reactions?limit=1&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`,
      )
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(secondPage.body.data.items).toHaveLength(1);
    expect(secondPage.body.data).toMatchObject({
      totalCount: 2,
      summary: firstPage.body.data.summary,
    });
    await request(app.getHttpServer())
      .delete(`/api/stories/${textId}/react`)
      .auth(secondFriendToken, { type: "bearer" })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/stories/${textId}/reactions`)
      .auth(friendToken, { type: "bearer" })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/stories/${textId}/like`)
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    const liked = await request(app.getHttpServer())
      .get(`/api/stories/${textId}/reactions`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(liked.body.data).toMatchObject({ totalCount: 1, summary: [{ emoji: "❤️", count: 1 }] });
    expect(liked.body.data.items).toHaveLength(1);
    expect(liked.body.data.items[0]).toMatchObject({
      user: { id: friend },
      emoji: "❤️",
      kind: "LIKE",
    });
    await request(app.getHttpServer())
      .delete(`/api/stories/${textId}/like`)
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    const removedReaction = await request(app.getHttpServer())
      .get(`/api/stories/${textId}/reactions`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(removedReaction.body.data).toMatchObject({ totalCount: 0, summary: [] });
    expect(removedReaction.body.data.items).toHaveLength(0);
    const reply = await request(app.getHttpServer())
      .post(`/api/stories/${textId}/reply`)
      .auth(friendToken, { type: "bearer" })
      .send({ body: "Hello from story" })
      .expect(201);
    expect(reply.body.data).toMatchObject({
      storyId: textId,
      body: "Hello from story",
      senderId: friend,
    });
    const messages = await request(app.getHttpServer())
      .get(`/api/conversations/${reply.body.data.conversationId}/messages`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(
      messages.body.data.items.some((item: { id: string }) => item.id === reply.body.data.id),
    ).toBe(true);
    await request(app.getHttpServer())
      .patch(`/api/stories/${textId}`)
      .auth(ownerToken, { type: "bearer" })
      .send({ allowReplies: false })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/stories/${textId}/reply`)
      .auth(friendToken, { type: "bearer" })
      .send({ body: "Disabled" })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/stories/${textId}`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/stories/${textId}`)
      .auth(friendToken, { type: "bearer" })
      .expect(404);
  }, 30000);

  it("does not cache a feed read that finishes after its story was deleted", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/stories")
      .auth(ownerToken, { type: "bearer" })
      .send({ kind: "TEXT", caption: "stale fill race" })
      .expect(201);
    const storyId = created.body.data.id as string;
    const repo = app.get<StoryRepository>(STORY_REPOSITORY);
    const findActive = repo.findActiveByUserIds.bind(repo);
    let release!: () => void;
    let notify!: () => void;
    const paused = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(repo, "findActiveByUserIds").mockImplementationOnce(async (...args) => {
      const result = await findActive(...args);
      notify();
      await resume;
      return result;
    });

    const pending = request(app.getHttpServer())
      .get("/api/stories/feed")
      .auth(friendToken, { type: "bearer" })
      .then((response) => response);
    try {
      await paused;
      await request(app.getHttpServer())
        .delete(`/api/stories/${storyId}`)
        .auth(ownerToken, { type: "bearer" })
        .expect(200);
    } finally {
      release();
    }
    const oldFeed = await pending;
    expect(oldFeed.status).toBe(200);
    expect(
      oldFeed.body.data.flatMap((group: { stories: { id: string }[] }) =>
        group.stories.map((story) => story.id),
      ),
    ).toContain(storyId);
    spy.mockRestore();
    const feed = await request(app.getHttpServer())
      .get("/api/stories/feed")
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    const ids = feed.body.data.flatMap((group: { stories: { id: string }[] }) =>
      group.stories.map((story) => story.id),
    );
    expect(ids).not.toContain(storyId);
  });

  it("does not cache a note feed read that finishes after the note was deleted", async () => {
    await request(app.getHttpServer())
      .put("/api/notes")
      .auth(ownerToken, { type: "bearer" })
      .send({ content: "stale note race" })
      .expect(200);
    const repo = app.get<NoteRepository>(NOTE_REPOSITORY);
    const findActive = repo.findActiveFeedByUserIds.bind(repo);
    let release!: () => void;
    let notify!: () => void;
    const paused = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(repo, "findActiveFeedByUserIds")
      .mockImplementationOnce(async (...args) => {
        const result = await findActive(...args);
        notify();
        await resume;
        return result;
      });
    const pending = request(app.getHttpServer())
      .get("/api/notes/feed")
      .auth(friendToken, { type: "bearer" })
      .then((response) => response);
    try {
      await paused;
      await request(app.getHttpServer())
        .delete("/api/notes/me")
        .auth(ownerToken, { type: "bearer" })
        .expect(200);
    } finally {
      release();
    }
    const oldFeed = await pending;
    expect(oldFeed.status).toBe(200);
    expect(
      oldFeed.body.data.map((item: { note: { content: string } }) => item.note.content),
    ).toContain("stale note race");
    spy.mockRestore();
    const feed = await request(app.getHttpServer())
      .get("/api/notes/feed")
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    expect(
      feed.body.data.map((item: { note: { content: string } }) => item.note.content),
    ).not.toContain("stale note race");
  });

  it("removes a deleted archived story and purges its database record", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/stories")
      .auth(ownerToken, { type: "bearer" })
      .send({ kind: "TEXT", caption: "Archive test" })
      .expect(201);
    const id: string = created.body.data.id;
    await db
      .update(stories)
      .set({
        archivedAt: new Date(),
        createdAt: new Date(Date.now() - 172800000),
        expiresAt: new Date(Date.now() - 86400000),
      })
      .where(eq(stories.id, id));
    await request(app.getHttpServer())
      .delete(`/api/stories/${id}`)
      .auth(friendToken, { type: "bearer" })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/stories/${id}`)
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    const archive = await request(app.getHttpServer())
      .get("/api/stories/archive")
      .auth(ownerToken, { type: "bearer" })
      .expect(200);
    expect(archive.body.data.items.some((item: { id: string }) => item.id === id)).toBe(false);
    await app.get(PurgeJob).run();
    expect(await db.select().from(stories).where(eq(stories.id, id))).toHaveLength(0);
  }, 30000);

  it("uploads and reads media only for an authorized user", async () => {
    const signed = await request(app.getHttpServer())
      .post("/api/files/presign")
      .auth(ownerToken, { type: "bearer" })
      .send({ kind: "STORY_IMAGE", sizeBytes: 4, mimeType: "image/jpeg", fileName: "test.jpg" })
      .expect(200);
    const uploaded = await fetch(signed.body.data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: "test",
    });
    expect(uploaded.ok).toBe(true);
    const created = await request(app.getHttpServer())
      .post("/api/stories")
      .auth(ownerToken, { type: "bearer" })
      .send({ kind: "IMAGE", objectKey: signed.body.data.objectKey })
      .expect(201);
    mediaId = created.body.data.id;
    const media = await request(app.getHttpServer())
      .get(`/api/stories/${mediaId}/media`)
      .auth(friendToken, { type: "bearer" })
      .expect(200);
    expect(await (await fetch(media.body.data.url)).text()).toBe("test");
    await request(app.getHttpServer())
      .get(`/api/stories/${mediaId}/media`)
      .auth(strangerToken, { type: "bearer" })
      .expect(403);
  }, 30000);
});
