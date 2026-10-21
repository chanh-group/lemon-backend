import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { friendships } from "../friend/schema.js";
import { users } from "../user/schema.js";
import type { StoryReactionResponse } from "./dto/response.js";
import type { UserSummary } from "../user/dto/response.js";
import type { PurgeableStory, StoryReactionResult, StoryRepository } from "./repository.js";
import { type NewStory, type Story, stories, storyReactions, storyViews } from "./schema.js";
import { toCursorPage, type CursorPage } from "../shared.js";

@Injectable()
export class StoryPgRepository implements StoryRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async create(data: NewStory): Promise<Story> {
    const [created] = await this.db.insert(stories).values(data).returning();
    return created;
  }

  async findById(id: string): Promise<Story | null> {
    const [story] = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.id, id), isNull(stories.deletedAt)));
    return story ?? null;
  }

  async findActiveById(id: string): Promise<Story | null> {
    const now = new Date();
    const [story] = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.id, id), gt(stories.expiresAt, now), isNull(stories.deletedAt)));
    return story ?? null;
  }

  async findActiveByUserIds(userIds: string[]): Promise<Story[]> {
    if (userIds.length === 0) return [];
    const now = new Date();
    return this.db
      .select()
      .from(stories)
      .where(
        and(
          inArray(stories.userId, userIds),
          gt(stories.expiresAt, now),
          isNull(stories.deletedAt),
        ),
      )
      .orderBy(asc(stories.createdAt));
  }

  async findUsersByIds(userIds: string[]): Promise<Map<string, UserSummary>> {
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

    const map = new Map<string, UserSummary>();
    for (const r of rows) {
      map.set(r.id, r);
    }
    return map;
  }

  async findViewersByStoryId(storyId: string, cursor: string | undefined, limit: number) {
    const cursorViewedAt = cursor
      ? sql`(SELECT sv.viewed_at FROM story_views sv WHERE sv.story_id = ${storyId} AND sv.user_id = ${cursor})`
      : undefined;
    const conditions = [eq(storyViews.storyId, storyId)];
    if (cursor && cursorViewedAt) {
      conditions.push(
        or(
          lt(storyViews.viewedAt, cursorViewedAt),
          and(eq(storyViews.viewedAt, cursorViewedAt), lt(users.id, cursor)),
        )!,
      );
    }
    const rows = await this.db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        viewedAt: storyViews.viewedAt,
        reaction: storyReactions.emoji,
      })
      .from(storyViews)
      .innerJoin(users, eq(storyViews.userId, users.id))
      .leftJoin(
        storyReactions,
        and(
          eq(storyViews.storyId, storyReactions.storyId),
          eq(storyViews.userId, storyReactions.userId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(storyViews.viewedAt), desc(users.id))
      .limit(limit + 1);

    const viewers = rows.map((r) => ({
      user: {
        id: r.userId,
        username: r.username,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
      },
      viewedAt: r.viewedAt,
      reaction: r.reaction ?? null,
    }));
    return toCursorPage(viewers, limit, (viewer) => viewer.user.id);
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

  async markDeleted(id: string): Promise<boolean> {
    const rows = await this.db
      .update(stories)
      .set({ deletedAt: new Date() })
      .where(and(eq(stories.id, id), isNull(stories.deletedAt)))
      .returning({ id: stories.id });
    return rows.length > 0;
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

  async isAcceptedFriend(userAId: string, userBId: string): Promise<boolean> {
    const [userLow, userHigh] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    const [relation] = await this.db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.userLow, userLow),
          eq(friendships.userHigh, userHigh),
          eq(friendships.status, "ACCEPTED"),
        ),
      )
      .limit(1);
    return Boolean(relation);
  }

  async findPurgeable(limit: number): Promise<PurgeableStory[]> {
    return this.db
      .select({ id: stories.id, objectKey: stories.objectKey })
      .from(stories)
      .where(or(lt(stories.expiresAt, sql`now()`), isNotNull(stories.deletedAt)))
      .orderBy(asc(stories.expiresAt))
      .limit(limit);
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .delete(stories)
      .where(inArray(stories.id, ids))
      .returning({ id: stories.id });
    return rows.length;
  }

  async addReactionWithView(
    storyId: string,
    userId: string,
    emoji: string,
  ): Promise<StoryReactionResult> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx.insert(storyViews).values({ storyId, userId, viewedAt: now }).onConflictDoNothing();

      const [row] = await tx
        .insert(storyReactions)
        .values({ storyId, userId, emoji, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [storyReactions.storyId, storyReactions.userId],
          // `created_at` is kept: it is the moment of the first reaction and
          // the stable sort key of the reaction list.
          set: { emoji, updatedAt: now },
        })
        .returning({
          storyId: storyReactions.storyId,
          userId: storyReactions.userId,
          emoji: storyReactions.emoji,
          createdAt: storyReactions.createdAt,
          updatedAt: storyReactions.updatedAt,
          // `xmax = 0` is true only for a freshly inserted row; an upsert that
          // updated an existing reaction sets xmax to the writing xid.
          isNew: sql<boolean>`xmax = 0`,
        });
      return {
        reaction: {
          storyId: row.storyId,
          userId: row.userId,
          emoji: row.emoji,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        isNew: row.isNew,
      };
    });
  }

  async deleteReaction(storyId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(storyReactions)
      .where(and(eq(storyReactions.storyId, storyId), eq(storyReactions.userId, userId)))
      .returning({ storyId: storyReactions.storyId });
    return rows.length > 0;
  }

  async findReactionsByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryReactionResponse>> {
    const cursorCreatedAt = cursor
      ? sql`(SELECT sr.created_at FROM story_reactions sr WHERE sr.story_id = ${storyId} AND sr.user_id = ${cursor})`
      : undefined;
    const conditions = [eq(storyReactions.storyId, storyId)];
    if (cursor && cursorCreatedAt) {
      conditions.push(
        or(
          lt(storyReactions.createdAt, cursorCreatedAt),
          and(eq(storyReactions.createdAt, cursorCreatedAt), lt(users.id, cursor)),
        )!,
      );
    }
    const rows = await this.db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        emoji: storyReactions.emoji,
        createdAt: storyReactions.createdAt,
      })
      .from(storyReactions)
      .innerJoin(users, eq(storyReactions.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(storyReactions.createdAt), desc(users.id))
      .limit(limit + 1);

    const reactions = rows.map((r) => ({
      user: {
        id: r.userId,
        username: r.username,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
      },
      emoji: r.emoji,
      createdAt: r.createdAt,
    }));
    return toCursorPage(reactions, limit, (reaction) => reaction.user.id);
  }

  async findUserReactions(userId: string, storyIds: string[]): Promise<Map<string, string>> {
    if (storyIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        storyId: storyReactions.storyId,
        emoji: storyReactions.emoji,
      })
      .from(storyReactions)
      .where(and(eq(storyReactions.userId, userId), inArray(storyReactions.storyId, storyIds)));

    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.storyId, r.emoji);
    }
    return map;
  }

  async countReactions(storyIds: string[]): Promise<Map<string, number>> {
    if (storyIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        storyId: storyReactions.storyId,
        count: sql<number>`count(*)::int`,
      })
      .from(storyReactions)
      .where(inArray(storyReactions.storyId, storyIds))
      .groupBy(storyReactions.storyId);

    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.storyId, Number(r.count));
    }
    return map;
  }
}
