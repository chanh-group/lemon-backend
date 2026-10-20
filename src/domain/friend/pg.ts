import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { users } from "../user/schema.js";
import type { FriendRepository } from "./repository.js";
import { friendships } from "./schema.js";
import { toCursorPage } from "../shared.js";

@Injectable()
export class FriendPgRepository implements FriendRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  private pair(userAId: string, userBId: string): [string, string] {
    return userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  }

  async findByPair(userAId: string, userBId: string) {
    const [userLow, userHigh] = this.pair(userAId, userBId);
    const [row] = await this.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
      .limit(1);
    return row ?? null;
  }

  async createRequest(requesterId: string, addresseeId: string) {
    const [userLow, userHigh] = this.pair(requesterId, addresseeId);
    const [created] = await this.db
      .insert(friendships)
      .values({ requesterId, addresseeId, userLow, userHigh, status: "PENDING" })
      .onConflictDoNothing({
        target: [friendships.userLow, friendships.userHigh],
      })
      .returning();

    if (created) return { friendship: created, created: true };

    const existing = await this.findByPair(requesterId, addresseeId);
    if (existing) return { friendship: existing, created: false };
    throw new Error("Friend request insert conflicted but the friendship row was not found");
  }

  async listFriendsPage(userId: string, cursor: string | undefined, limit: number) {
    const cursorFilter = cursor ? gt(users.id, cursor) : undefined;
    const [outgoing, incoming] = await Promise.all([
      this.db
        .select({
          id: users.id,
          name: users.fullName,
          username: users.username,
          email: users.email,
          avatarUrl: users.avatarUrl,
        })
        .from(friendships)
        .innerJoin(users, eq(friendships.addresseeId, users.id))
        .where(
          and(
            eq(friendships.requesterId, userId),
            eq(friendships.status, "ACCEPTED"),
            isNull(users.deletedAt),
            cursorFilter,
          ),
        )
        .orderBy(asc(users.id))
        .limit(limit + 1),
      this.db
        .select({
          id: users.id,
          name: users.fullName,
          username: users.username,
          email: users.email,
          avatarUrl: users.avatarUrl,
        })
        .from(friendships)
        .innerJoin(users, eq(friendships.requesterId, users.id))
        .where(
          and(
            eq(friendships.addresseeId, userId),
            eq(friendships.status, "ACCEPTED"),
            isNull(users.deletedAt),
            cursorFilter,
          ),
        )
        .orderBy(asc(users.id))
        .limit(limit + 1),
    ]);
    const merged = [...outgoing, ...incoming].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    return toCursorPage(merged.slice(0, limit + 1), limit, (friend) => friend.id);
  }

  async findAcceptedFriendIds(userId: string, candidates: string[]): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    const rows = await this.db
      .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "ACCEPTED"),
          or(
            and(eq(friendships.userLow, userId), inArray(friendships.userHigh, candidates)),
            and(eq(friendships.userHigh, userId), inArray(friendships.userLow, candidates)),
          ),
        ),
      );
    return new Set(rows.map((row) => (row.userLow === userId ? row.userHigh : row.userLow)));
  }

  async listRequestsPage(
    userId: string,
    incomingCursor: string | undefined,
    outgoingCursor: string | undefined,
    limit: number,
  ) {
    const [incomingRows, outgoingRows] = await Promise.all([
      this.db
        .select({
          id: friendships.id,
          createdAt: friendships.createdAt,
          user: {
            id: users.id,
            name: users.fullName,
            username: users.username,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(friendships)
        .innerJoin(users, eq(friendships.requesterId, users.id))
        .where(
          and(
            eq(friendships.addresseeId, userId),
            eq(friendships.status, "PENDING"),
            isNull(users.deletedAt),
            incomingCursor ? gt(friendships.id, incomingCursor) : undefined,
          ),
        )
        .orderBy(asc(friendships.id))
        .limit(limit + 1),
      this.db
        .select({
          id: friendships.id,
          createdAt: friendships.createdAt,
          user: {
            id: users.id,
            name: users.fullName,
            username: users.username,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(friendships)
        .innerJoin(users, eq(friendships.addresseeId, users.id))
        .where(
          and(
            eq(friendships.requesterId, userId),
            eq(friendships.status, "PENDING"),
            isNull(users.deletedAt),
            outgoingCursor ? gt(friendships.id, outgoingCursor) : undefined,
          ),
        )
        .orderBy(asc(friendships.id))
        .limit(limit + 1),
    ]);
    return {
      incoming: toCursorPage(
        incomingRows.map((row) => ({ ...row, direction: "incoming" as const })),
        limit,
        (row) => row.id,
      ),
      outgoing: toCursorPage(
        outgoingRows.map((row) => ({ ...row, direction: "outgoing" as const })),
        limit,
        (row) => row.id,
      ),
    };
  }

  async acceptRequest(
    requestId: string,
    addresseeId: string,
  ): Promise<{ requesterId: string; addresseeId: string } | null> {
    const [row] = await this.db
      .update(friendships)
      .set({ status: "ACCEPTED", respondedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(friendships.id, requestId),
          eq(friendships.addresseeId, addresseeId),
          eq(friendships.status, "PENDING"),
        ),
      )
      .returning({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId });
    return row ?? null;
  }

  async deleteIncomingRequest(requestId: string, addresseeId: string): Promise<boolean> {
    const [row] = await this.db
      .delete(friendships)
      .where(
        and(
          eq(friendships.id, requestId),
          eq(friendships.addresseeId, addresseeId),
          eq(friendships.status, "PENDING"),
        ),
      )
      .returning({ id: friendships.id });
    return Boolean(row);
  }

  async deleteOutgoingRequest(requestId: string, requesterId: string): Promise<boolean> {
    const [row] = await this.db
      .delete(friendships)
      .where(
        and(
          eq(friendships.id, requestId),
          eq(friendships.requesterId, requesterId),
          eq(friendships.status, "PENDING"),
        ),
      )
      .returning({ id: friendships.id });
    return Boolean(row);
  }

  async deleteAcceptedPair(userAId: string, userBId: string): Promise<boolean> {
    const [userLow, userHigh] = this.pair(userAId, userBId);
    const [row] = await this.db
      .delete(friendships)
      .where(
        and(
          eq(friendships.userLow, userLow),
          eq(friendships.userHigh, userHigh),
          eq(friendships.status, "ACCEPTED"),
        ),
      )
      .returning({ id: friendships.id });
    return Boolean(row);
  }

  async blockPair(blockerId: string, targetId: string): Promise<void> {
    const [userLow, userHigh] = this.pair(blockerId, targetId);
    await this.db
      .insert(friendships)
      .values({
        requesterId: blockerId,
        addresseeId: targetId,
        userLow,
        userHigh,
        status: "BLOCKED",
        respondedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [friendships.userLow, friendships.userHigh],
        set: {
          requesterId: blockerId,
          addresseeId: targetId,
          status: "BLOCKED",
          respondedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
}
