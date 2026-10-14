import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { friendships } from "../friend/schema.js";
import { users } from "../user/schema.js";
import type { StoryUserSummary, StoryViewerResponse } from "./dto/response.js";
import type { StoryRepository } from "./repository.js";
import { type NewStory, type Story, stories, storyViews } from "./schema.js";

@Injectable()
export class StoryPgRepository implements StoryRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async create(data: NewStory): Promise<Story> {
    const [created] = await this.db.insert(stories).values(data).returning();
    return created;
  }

  async findById(id: string): Promise<Story | null> {
    const [story] = await this.db.select().from(stories).where(eq(stories.id, id));
    return story ?? null;
  }

  async findActiveById(id: string): Promise<Story | null> {
    const now = new Date();
    const [story] = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.id, id), gt(stories.expiresAt, now)));
    return story ?? null;
  }

  async findActiveByUserIds(userIds: string[]): Promise<Story[]> {
    if (userIds.length === 0) return [];
    const now = new Date();
    return this.db
      .select()
      .from(stories)
      .where(and(inArray(stories.userId, userIds), gt(stories.expiresAt, now)))
      .orderBy(asc(stories.createdAt));
  }

  async findUsersByIds(userIds: string[]): Promise<Map<string, StoryUserSummary>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(inArray(users.id, userIds));

    const map = new Map<string, StoryUserSummary>();
    for (const r of rows) {
      map.set(r.id, r);
    }
    return map;
  }

  async findViewersByStoryId(storyId: string): Promise<StoryViewerResponse[]> {
    const rows = await this.db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        viewedAt: storyViews.viewedAt,
      })
      .from(storyViews)
      .innerJoin(users, eq(storyViews.userId, users.id))
      .where(eq(storyViews.storyId, storyId))
      .orderBy(desc(storyViews.viewedAt));

    return rows.map((r) => ({
      user: {
        id: r.userId,
        username: r.username,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
      },
      viewedAt: r.viewedAt,
    }));
  }

  async findViewedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    if (storyIds.length === 0) return new Set();
    const rows = await this.db
      .select({ storyId: storyViews.storyId })
      .from(storyViews)
      .where(and(eq(storyViews.userId, userId), inArray(storyViews.storyId, storyIds)));

    return new Set(rows.map((r) => r.storyId));
  }

  async markAsViewed(storyId: string, userId: string): Promise<void> {
    await this.db
      .insert(storyViews)
      .values({ storyId, userId, viewedAt: new Date() })
      .onConflictDoNothing();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(stories).where(eq(stories.id, id)).returning({ id: stories.id });
    return result.length > 0;
  }

  async getFriendUserIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({
        userLow: friendships.userLow,
        userHigh: friendships.userHigh,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "ACCEPTED"),
          or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
        ),
      );

    return rows.map((r) => (r.userLow === userId ? r.userHigh : r.userLow));
  }
}
