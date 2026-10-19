import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { users } from "../user/schema.js";
import type { FriendRepository, FriendRequestRecord, FriendUser } from "./repository.js";
import { friendships } from "./schema.js";

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

  async listRequests(
    userId: string,
  ): Promise<{ incoming: FriendRequestRecord[]; outgoing: FriendRequestRecord[] }> {
    const incomingRows = await this.db
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
        ),
      );

    const outgoingRows = await this.db
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
        ),
      );

    return {
      incoming: incomingRows.map((row) => ({ ...row, direction: "incoming" })),
      outgoing: outgoingRows.map((row) => ({ ...row, direction: "outgoing" })),
    };
  }

  async listFriends(userId: string): Promise<FriendUser[]> {
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
          ),
        ),
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
          ),
        ),
    ]);
    return [...outgoing, ...incoming];
  }

  async acceptRequest(requestId: string, addresseeId: string): Promise<boolean> {
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
      .returning({ id: friendships.id });
    return Boolean(row);
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
