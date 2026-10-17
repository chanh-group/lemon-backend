import { and, eq, gt, inArray, or } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { DrizzleDb } from "../../configs/database.js";
import { friendships } from "../friend/schema.js";
import { users } from "../user/schema.js";
import { notes, type Note } from "./schema.js";
import type { NoteRepository } from "./repository.js";
import type { UserSummary } from "../user/dto/response.js";

@Injectable()
export class NotePgRepository implements NoteRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async upsert(
    userId: string,
    data: { content: string; background?: string | null; expiresAt: Date },
  ): Promise<Note> {
    const now = new Date();
    const [row] = await this.db
      .insert(notes)
      .values({
        userId,
        content: data.content,
        background: data.background ?? null,
        expiresAt: data.expiresAt,
      })
      .onConflictDoUpdate({
        target: notes.userId,
        set: {
          content: data.content,
          background: data.background ?? null,
          expiresAt: data.expiresAt,
          createdAt: now,
        },
      })
      .returning();
    return row;
  }

  async findActiveByUserId(userId: string): Promise<Note | null> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, userId), gt(notes.expiresAt, new Date())))
      .limit(1);

    return rows[0] ?? null;
  }

  async findActiveByUserIds(userIds: string[]): Promise<Note[]> {
    if (userIds.length === 0) return [];

    return await this.db
      .select()
      .from(notes)
      .where(and(inArray(notes.userId, userIds), gt(notes.expiresAt, new Date())));
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

    return new Map(rows.map((u) => [u.id, u]));
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

  async deleteByUserId(userId: string): Promise<boolean> {
    const result = await this.db
      .delete(notes)
      .where(eq(notes.userId, userId))
      .returning({ id: notes.id });
    return result.length > 0;
  }
}
