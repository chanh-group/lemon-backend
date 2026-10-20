import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { users } from "../user/schema.js";
import { conversationParticipants, conversations } from "../conversation/schema.js";
import type { AcceptedFriendRequest, FriendRepository } from "./repository.js";
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
  ): Promise<AcceptedFriendRequest | null> {
    return this.db.transaction(async (tx) => {
      const [accepted] = await tx
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
      if (!accepted) return null;

      const [userLow, userHigh] = this.pair(accepted.requesterId, accepted.addresseeId);
      const directKey = `${userLow}:${userHigh}`;
      let [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.directKey, directKey))
        .limit(1);

      if (!conversation) {
        [conversation] = await tx
          .insert(conversations)
          .values({ kind: "DIRECT", directKey })
          .onConflictDoNothing()
          .returning();
        // Another request may have created the same pair concurrently.
        if (!conversation) {
          [conversation] = await tx
            .select()
            .from(conversations)
            .where(eq(conversations.directKey, directKey))
            .limit(1);
        }
      }
      if (!conversation) throw new Error("Accepted friendship has no direct conversation");

      if (conversation.deletedAt) {
        [conversation] = await tx
          .update(conversations)
          .set({ deletedAt: null })
          .where(eq(conversations.id, conversation.id))
          .returning();
      }

      await tx
        .insert(conversationParticipants)
        .values([
          { conversationId: conversation.id, userId: userLow, role: "MEMBER" },
          { conversationId: conversation.id, userId: userHigh, role: "MEMBER" },
        ])
        .onConflictDoUpdate({
          target: [conversationParticipants.conversationId, conversationParticipants.userId],
          set: { leftAt: null },
        });

      const [partner] = await tx
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, accepted.requesterId))
        .limit(1);
      if (!partner) throw new Error("Accepted friend requester was not found");

      return {
        ...accepted,
        conversation: {
          id: conversation.id,
          kind: "DIRECT",
          partner: { ...partner, isOnline: false },
          lastMessagePreview: conversation.lastMessagePreview,
          lastMessageAt: conversation.lastMessageAt,
          unreadCount: 0,
          createdAt: conversation.createdAt,
        },
      };
    });
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
