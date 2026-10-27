import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { friendships } from "../friend/schema.js";
import { messages } from "../message/schema.js";
import { users } from "../user/schema.js";
import type { StoryReactionKind } from "./constants.js";
import type {
  StoryItemResponse,
  StoryReactionResponse,
  StoryViewersListResponse,
} from "./dto/response.js";
import type { UserSummary } from "../user/dto/response.js";
import type {
  PurgeableStory,
  StoryReactionResult,
  StoryRepository,
  UserReactionDetail,
  UserStorySettingsValues,
} from "./repository.js";
import {
  type NewStory,
  type Story,
  stories,
  storyAudiences,
  storyMutes,
  storyReactions,
  storyViews,
  userStorySettings,
} from "./schema.js";
import { BusinessError } from "../../utils/errors/business.js";
import { STORY_TTL_MS } from "../../utils/cache/constants.js";
import { isUuid, toCursorPage, type CursorPage } from "../shared.js";
import { decodeReactionCursor, encodeReactionCursor, toStoryItemResponse } from "./dto/mapper.js";

@Injectable()
export class StoryPgRepository implements StoryRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async create(
    data: Omit<NewStory, "createdAt" | "expiresAt">,
    audienceUserIds?: string[],
  ): Promise<Story> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(stories)
        .values({
          ...data,
          expiresAt: sql`now() + ${STORY_TTL_MS} * interval '1 millisecond'`,
        })
        .returning();
      if (data.audienceMode !== "ALL_FRIENDS" && audienceUserIds && audienceUserIds.length > 0) {
        await tx.insert(storyAudiences).values(
          audienceUserIds.map((userId) => ({
            storyId: created.id,
            userId,
          })),
        );
      }
      return created;
    });
  }

  async findById(id: string): Promise<Story | null> {
    const [story] = await this.db
      .select()
      .from(stories)
      .where(and(eq(stories.id, id), isNull(stories.deletedAt)));
    return story ?? null;
  }

  async findActiveById(id: string): Promise<Story | null> {
    const [story] = await this.db
      .select()
      .from(stories)
      .where(
        and(
          eq(stories.id, id),
          gt(stories.expiresAt, sql`now()`),
          isNull(stories.deletedAt),
          isNull(stories.archivedAt),
        ),
      );
    return story ?? null;
  }

  async findActiveByUserIds(userIds: string[], viewerId?: string): Promise<Story[]> {
    if (userIds.length === 0) return [];

    const conditions = [
      inArray(stories.userId, userIds),
      gt(stories.expiresAt, sql`now()`),
      isNull(stories.deletedAt),
      isNull(stories.archivedAt),
    ];

    if (viewerId) {
      // Exclude muted authors
      const mutedRows = await this.db
        .select({ authorId: storyMutes.authorId })
        .from(storyMutes)
        .where(eq(storyMutes.userId, viewerId));
      const mutedAuthorIds = mutedRows.map((r) => r.authorId);
      if (mutedAuthorIds.length > 0) {
        conditions.push(notInArray(stories.userId, mutedAuthorIds));
      }

      // Filter audience: author always sees their own; for others, check audienceMode
      conditions.push(
        or(
          eq(stories.userId, viewerId),
          and(eq(stories.audienceMode, "ALL_FRIENDS")),
          and(
            eq(stories.audienceMode, "CUSTOM"),
            inArray(
              stories.id,
              this.db
                .select({ storyId: storyAudiences.storyId })
                .from(storyAudiences)
                .where(eq(storyAudiences.userId, viewerId)),
            ),
          ),
          and(
            eq(stories.audienceMode, "EXCLUDE"),
            notInArray(
              stories.id,
              this.db
                .select({ storyId: storyAudiences.storyId })
                .from(storyAudiences)
                .where(eq(storyAudiences.userId, viewerId)),
            ),
          ),
        )!,
      );
    }

    return this.db
      .select()
      .from(stories)
      .where(and(...conditions))
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

  async findViewersByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<StoryViewersListResponse> {
    const cursorViewedAt = cursor
      ? sql`(SELECT sv.viewed_at FROM story_views sv WHERE sv.story_id = ${storyId} AND sv.user_id = ${cursor})`
      : undefined;

    // Viewers list filters anonymous=false and retains identities for 24h
    const conditions = [
      eq(storyViews.storyId, storyId),
      eq(storyViews.anonymous, false),
      gte(storyViews.viewedAt, sql`now() - interval '24 hours'`),
    ];

    if (cursor && cursorViewedAt) {
      conditions.push(
        or(
          lt(storyViews.viewedAt, cursorViewedAt),
          and(eq(storyViews.viewedAt, cursorViewedAt), lt(users.id, cursor)),
        )!,
      );
    }

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          userId: users.id,
          username: users.username,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
          viewedAt: storyViews.viewedAt,
          reaction: storyReactions.emoji,
          reactionKind: storyReactions.kind,
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
        .limit(limit + 1),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(storyViews)
        .where(eq(storyViews.storyId, storyId)),
    ]);

    const totalViewsCount = Number(countResult[0]?.total ?? 0);

    const viewers = rows.map((r) => ({
      user: {
        id: r.userId,
        username: r.username,
        fullName: r.fullName,
        avatarUrl: r.avatarUrl,
      },
      viewedAt: r.viewedAt,
      reaction: r.reaction ?? null,
      reactionKind: r.reactionKind ?? null,
    }));

    const page = toCursorPage(viewers, limit, (viewer) => viewer.user.id);
    return {
      items: page.items,
      nextCursor: page.nextCursor ?? null,
      hasMore: page.hasMore,
      totalViewsCount,
    };
  }

  async findViewedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    if (storyIds.length === 0) return new Set();
    const rows = await this.db
      .select({ storyId: storyViews.storyId })
      .from(storyViews)
      .where(and(eq(storyViews.userId, userId), inArray(storyViews.storyId, storyIds)));

    return new Set(rows.map((r) => r.storyId));
  }

  async markAsViewed(storyId: string, userId: string, anonymous: boolean = false): Promise<void> {
    await this.db.insert(storyViews).values({ storyId, userId, anonymous }).onConflictDoNothing();
  }

  async markDeleted(id: string): Promise<boolean> {
    const rows = await this.db
      .update(stories)
      .set({ deletedAt: sql`now()` })
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
    const rows = await this.db
      .select({
        id: stories.id,
        objectKey: stories.objectKey,
        userId: stories.userId,
        archivedAt: stories.archivedAt,
        deletedAt: stories.deletedAt,
        archiveEnabled: userStorySettings.archiveEnabled,
      })
      .from(stories)
      .leftJoin(userStorySettings, eq(userStorySettings.userId, stories.userId))
      .where(
        or(
          and(
            isNull(stories.archivedAt),
            or(lt(stories.expiresAt, sql`now()`), isNotNull(stories.deletedAt)),
          ),
          and(
            isNotNull(stories.archivedAt),
            or(
              eq(userStorySettings.archiveEnabled, false),
              and(
                isNotNull(userStorySettings.archiveDurationSecs),
                sql`${stories.archivedAt} + ${userStorySettings.archiveDurationSecs} * interval '1 second' <= now()`,
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(stories.expiresAt))
      .limit(limit);
    return rows.map((row) => ({ ...row, archiveEnabled: row.archiveEnabled ?? true }));
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .delete(stories)
      .where(inArray(stories.id, ids))
      .returning({ id: stories.id });
    return rows.length;
  }

  async archiveStories(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      // Set messages.story_id to null so snapshot is preserved without dangling FK
      await tx.update(messages).set({ storyId: null }).where(inArray(messages.storyId, ids));

      // Keep media pointers so archived stories remain viewable.
      const rows = await tx
        .update(stories)
        .set({
          archivedAt: sql`now()`,
        })
        .where(inArray(stories.id, ids))
        .returning({ id: stories.id });
      return rows.length;
    });
  }

  async addReactionWithView(
    storyId: string,
    userId: string,
    emoji: string,
    kind: StoryReactionKind = "REACTION",
    anonymous: boolean = false,
  ): Promise<StoryReactionResult> {
    return this.db.transaction(async (tx) => {
      await tx.insert(storyViews).values({ storyId, userId, anonymous }).onConflictDoNothing();

      const [row] = await tx
        .insert(storyReactions)
        .values({ storyId, userId, emoji, kind })
        .onConflictDoUpdate({
          target: [storyReactions.storyId, storyReactions.userId],
          set: { emoji, kind, updatedAt: sql`now()` },
        })
        .returning({
          storyId: storyReactions.storyId,
          userId: storyReactions.userId,
          emoji: storyReactions.emoji,
          kind: storyReactions.kind,
          createdAt: storyReactions.createdAt,
          updatedAt: storyReactions.updatedAt,
          isNew: sql<boolean>`xmax = 0`,
        });
      return {
        reaction: {
          storyId: row.storyId,
          userId: row.userId,
          emoji: row.emoji,
          kind: row.kind,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        isNew: row.isNew,
      };
    });
  }

  async deleteReaction(
    storyId: string,
    userId: string,
    kind?: StoryReactionKind,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(storyReactions)
      .where(
        and(
          eq(storyReactions.storyId, storyId),
          eq(storyReactions.userId, userId),
          kind ? eq(storyReactions.kind, kind) : undefined,
        ),
      )
      .returning({ storyId: storyReactions.storyId });
    return rows.length > 0;
  }

  async findReactionsByStoryId(
    storyId: string,
    cursor: string | undefined,
    limit: number,
    kind?: StoryReactionKind,
  ): Promise<CursorPage<StoryReactionResponse>> {
    const conditions = [eq(storyReactions.storyId, storyId)];
    if (kind) {
      conditions.push(eq(storyReactions.kind, kind));
    }
    if (cursor) {
      const decoded = decodeReactionCursor(cursor);
      if (decoded) {
        conditions.push(
          or(
            lt(storyReactions.createdAt, decoded.createdAt),
            and(eq(storyReactions.createdAt, decoded.createdAt), lt(users.id, decoded.userId)),
          )!,
        );
      } else if (isUuid(cursor)) {
        const cursorCreatedAt = sql`(SELECT sr.created_at FROM story_reactions sr WHERE sr.story_id = ${storyId} AND sr.user_id = ${cursor})`;
        conditions.push(
          or(
            lt(storyReactions.createdAt, cursorCreatedAt),
            and(eq(storyReactions.createdAt, cursorCreatedAt), lt(users.id, cursor)),
          )!,
        );
      } else {
        throw new BusinessError("BAD_REQUEST");
      }
    }
    const rows = await this.db
      .select({
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        emoji: storyReactions.emoji,
        kind: storyReactions.kind,
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
      kind: r.kind,
      createdAt: r.createdAt,
    }));
    return toCursorPage(reactions, limit, (reaction) =>
      encodeReactionCursor(reaction.createdAt, reaction.user.id),
    );
  }

  async findUserReactions(
    userId: string,
    storyIds: string[],
  ): Promise<Map<string, UserReactionDetail>> {
    if (storyIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        storyId: storyReactions.storyId,
        emoji: storyReactions.emoji,
        kind: storyReactions.kind,
      })
      .from(storyReactions)
      .where(and(eq(storyReactions.userId, userId), inArray(storyReactions.storyId, storyIds)));

    const map = new Map<string, UserReactionDetail>();
    for (const r of rows) {
      map.set(r.storyId, { emoji: r.emoji, kind: r.kind });
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

  // Settings
  async getUserStorySettings(userId: string): Promise<UserStorySettingsValues> {
    const [settings] = await this.db
      .select({
        userId: userStorySettings.userId,
        viewedReceiptsEnabled: userStorySettings.viewedReceiptsEnabled,
        archiveEnabled: userStorySettings.archiveEnabled,
        archiveDurationSecs: userStorySettings.archiveDurationSecs,
      })
      .from(userStorySettings)
      .where(eq(userStorySettings.userId, userId));

    if (settings) {
      return settings;
    }

    return {
      userId,
      viewedReceiptsEnabled: true,
      archiveEnabled: true,
      archiveDurationSecs: null,
    };
  }

  async upsertUserStorySettings(
    userId: string,
    data: {
      viewedReceiptsEnabled?: boolean;
      archiveEnabled?: boolean;
      archiveDurationSecs?: number | null;
    },
  ): Promise<UserStorySettingsValues> {
    const [row] = await this.db
      .insert(userStorySettings)
      .values({
        userId,
        viewedReceiptsEnabled: data.viewedReceiptsEnabled ?? true,
        archiveEnabled: data.archiveEnabled ?? true,
        archiveDurationSecs: data.archiveDurationSecs ?? null,
      })
      .onConflictDoUpdate({
        target: [userStorySettings.userId],
        set: {
          ...(data.viewedReceiptsEnabled !== undefined && {
            viewedReceiptsEnabled: data.viewedReceiptsEnabled,
          }),
          ...(data.archiveEnabled !== undefined && {
            archiveEnabled: data.archiveEnabled,
          }),
          ...(data.archiveDurationSecs !== undefined && {
            archiveDurationSecs: data.archiveDurationSecs,
          }),
          updatedAt: sql`now()`,
        },
      })
      .returning({
        userId: userStorySettings.userId,
        viewedReceiptsEnabled: userStorySettings.viewedReceiptsEnabled,
        archiveEnabled: userStorySettings.archiveEnabled,
        archiveDurationSecs: userStorySettings.archiveDurationSecs,
      });
    return row;
  }

  // Audience
  async findStoryAudienceUserIds(storyId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: storyAudiences.userId })
      .from(storyAudiences)
      .where(eq(storyAudiences.storyId, storyId));
    return rows.map((r) => r.userId);
  }

  async isStoryAudience(storyId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: storyAudiences.userId })
      .from(storyAudiences)
      .where(and(eq(storyAudiences.storyId, storyId), eq(storyAudiences.userId, userId)))
      .limit(1);
    return Boolean(row);
  }

  // Mutes
  async muteAuthor(userId: string, authorId: string): Promise<void> {
    await this.db.insert(storyMutes).values({ userId, authorId }).onConflictDoNothing();
  }

  async unmuteAuthor(userId: string, authorId: string): Promise<boolean> {
    const rows = await this.db
      .delete(storyMutes)
      .where(and(eq(storyMutes.userId, userId), eq(storyMutes.authorId, authorId)))
      .returning({ userId: storyMutes.userId });
    return rows.length > 0;
  }

  async getMutedAuthorIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ authorId: storyMutes.authorId })
      .from(storyMutes)
      .where(eq(storyMutes.userId, userId));
    return rows.map((r) => r.authorId);
  }

  async isAuthorMuted(userId: string, authorId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ authorId: storyMutes.authorId })
      .from(storyMutes)
      .where(and(eq(storyMutes.userId, userId), eq(storyMutes.authorId, authorId)))
      .limit(1);
    return Boolean(row);
  }

  // Archives
  async findArchivedStoriesByUserId(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StoryItemResponse>> {
    const cursorCreatedAt = cursor
      ? sql`(SELECT s.created_at FROM stories s WHERE s.id = ${cursor} AND s.user_id = ${userId})`
      : undefined;

    const conditions = [
      eq(stories.userId, userId),
      isNotNull(stories.archivedAt),
      isNull(stories.deletedAt),
    ];

    if (cursor && cursorCreatedAt) {
      conditions.push(
        or(
          lt(stories.createdAt, cursorCreatedAt),
          and(eq(stories.createdAt, cursorCreatedAt), lt(stories.id, cursor)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(stories)
      .where(and(...conditions))
      .orderBy(desc(stories.createdAt), desc(stories.id))
      .limit(limit + 1);

    const items = rows.map((s) => toStoryItemResponse(s));
    return toCursorPage(items, limit, (s) => s.id);
  }
}
