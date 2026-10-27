import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isUniqueViolation } from "../../utils/errors/pg.js";
import { messages } from "../message/schema.js";
import { users } from "../user/schema.js";
import type { ConversationRepository, ConversationWithPartner } from "./repository.js";
import { conversationParticipants, conversations } from "./schema.js";
import { toCursorPage } from "../shared.js";

const partnerParticipants = alias(conversationParticipants, "partner_participants");

@Injectable()
export class ConversationPgRepository implements ConversationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  private getDirectKey(userAId: string, userBId: string): string {
    const [low, high] = this.canonicalParticipants(userAId, userBId);
    return `${low}:${high}`;
  }

  private canonicalParticipants(userAId: string, userBId: string): [string, string] {
    return userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  }

  async findDirectByParticipants(
    userAId: string,
    userBId: string,
  ): Promise<ConversationWithPartner | null> {
    const directKey = this.getDirectKey(userAId, userBId);

    const [row] = await this.db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        directKey: conversations.directKey,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        partner: {
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(conversations)
      .innerJoin(users, eq(users.id, userBId))
      .where(and(eq(conversations.directKey, directKey), isNull(conversations.deletedAt)))
      .limit(1);

    return row ?? null;
  }

  async createDirectConversation(
    userAId: string,
    userBId: string,
  ): Promise<ConversationWithPartner> {
    const directKey = this.getDirectKey(userAId, userBId);

    try {
      return await this.db.transaction(async (tx) => {
        const [existingConv] = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.directKey, directKey))
          .limit(1);

        let convId: string;
        let createdAt: Date;
        let lastMessagePreview: string | null = null;
        let lastMessageAt: Date | null = null;

        if (existingConv) {
          convId = existingConv.id;
          createdAt = existingConv.createdAt;
          lastMessagePreview = existingConv.lastMessagePreview;
          lastMessageAt = existingConv.lastMessageAt;
        } else {
          const [newConv] = await tx
            .insert(conversations)
            .values({
              kind: "DIRECT",
              directKey,
            })
            .returning();
          convId = newConv.id;
          createdAt = newConv.createdAt;
        }

        // Ensure both participants exist
        const [participantLow, participantHigh] = this.canonicalParticipants(userAId, userBId);
        await tx
          .insert(conversationParticipants)
          .values([
            { conversationId: convId, userId: participantLow, role: "MEMBER" },
            { conversationId: convId, userId: participantHigh, role: "MEMBER" },
          ])
          .onConflictDoNothing();

        const [partner] = await tx
          .select({
            id: users.id,
            username: users.username,
            fullName: users.fullName,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(eq(users.id, userBId))
          .limit(1);

        return {
          id: convId,
          kind: "DIRECT",
          directKey,
          lastMessagePreview,
          lastMessageAt,
          createdAt,
          partner,
        };
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err, "conversations_direct_key_uq")) {
        const existing = await this.findDirectByParticipants(userAId, userBId);
        if (existing) return existing;
        throw new BusinessError("CONFLICT");
      }
      throw err;
    }
  }

  async findUserConversations(userId: string, limit: number, cursor?: string) {
    // Apply pagination before loading participant details so users with many
    // conversations do not create an unbounded IN list.
    const activityOrder = sql`COALESCE(${conversations.lastMessageAt}, ${conversations.createdAt})`;
    const cursorActivity = cursor
      ? sql`(SELECT COALESCE(c.last_message_at, c.created_at)
          FROM conversations c
          INNER JOIN conversation_participants cp ON cp.conversation_id = c.id
          WHERE c.id = ${cursor} AND cp.user_id = ${userId}
            AND cp.left_at IS NULL AND c.deleted_at IS NULL)`
      : undefined;
    const conditions = [
      eq(conversationParticipants.userId, userId),
      isNull(conversationParticipants.leftAt),
      isNull(conversations.deletedAt),
    ];
    if (cursor && cursorActivity) {
      conditions.push(
        or(
          lt(activityOrder, cursorActivity),
          and(eq(activityOrder, cursorActivity), lt(conversations.id, cursor)),
        )!,
      );
    }
    const convRows = await this.db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        directKey: conversations.directKey,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
      })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
      .where(and(...conditions))
      .orderBy(desc(activityOrder), desc(conversations.id))
      .limit(limit + 1);
    const page = toCursorPage(convRows, limit, (conversation) => conversation.id);
    if (page.items.length === 0) return page;

    const directIds = page.items.filter((conv) => conv.kind === "DIRECT").map((conv) => conv.id);
    if (directIds.length === 0) {
      return {
        ...page,
        items: page.items.map((conv) => ({ ...conv, lastReadMessageId: conv.lastReadMessageId })),
      };
    }

    // Fetch partners in one query for the paginated direct conversations.
    const otherParticipants = await this.db
      .select({
        conversationId: conversationParticipants.conversationId,
        user: {
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(
        and(
          inArray(conversationParticipants.conversationId, directIds),
          ne(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      );

    const partnerMap = new Map(otherParticipants.map((p) => [p.conversationId, p.user]));

    return {
      ...page,
      items: page.items.map((conv) => ({ ...conv, partner: partnerMap.get(conv.id) })),
    };
  }

  async findById(conversationId: string, userId: string): Promise<ConversationWithPartner | null> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        directKey: conversations.directKey,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
        partnerId: users.id,
        partnerUsername: users.username,
        partnerFullName: users.fullName,
        partnerAvatarUrl: users.avatarUrl,
      })
      .from(conversations)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, conversations.id),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .leftJoin(
        partnerParticipants,
        and(
          eq(partnerParticipants.conversationId, conversations.id),
          ne(partnerParticipants.userId, userId),
          isNull(partnerParticipants.leftAt),
        ),
      )
      .leftJoin(users, eq(partnerParticipants.userId, users.id))
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      kind: row.kind,
      directKey: row.directKey,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      partner:
        row.partnerId && row.partnerUsername && row.partnerFullName
          ? {
              id: row.partnerId,
              username: row.partnerUsername,
              fullName: row.partnerFullName,
              avatarUrl: row.partnerAvatarUrl,
            }
          : undefined,
      lastReadMessageId: row.lastReadMessageId,
    };
  }

  async existsById(conversationId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  async isMessageInConversation(conversationId: string, messageId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
      .limit(1);
    return Boolean(row);
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async getParticipantUserIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          isNull(conversationParticipants.leftAt),
        ),
      );
    return rows.map((r) => r.userId);
  }

  async getActiveConversationIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.leftAt)),
      );
    return rows.map((row) => row.conversationId);
  }

  async updateLastRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.db
      .update(conversationParticipants)
      .set({
        lastReadMessageId: messageId,
        lastReadAt: sql`now()`,
      })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
          sql`(
            ${conversationParticipants.lastReadMessageId} IS NULL
            OR (SELECT m.created_at, m.id FROM messages m WHERE m.id = ${messageId})
              > (SELECT m.created_at, m.id FROM messages m WHERE m.id = ${conversationParticipants.lastReadMessageId})
          )`,
        ),
      );
  }

  async countUnread(conversationId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .where(
        and(
          eq(messages.conversationId, conversationId),
          isNull(messages.deletedAt),
          ne(messages.senderId, userId),
          or(
            isNull(conversationParticipants.lastReadMessageId),
            sql`(${messages.createdAt}, ${messages.id}) > (
              SELECT m.created_at, m.id
              FROM messages m
              WHERE m.id = ${conversationParticipants.lastReadMessageId}
            )`,
          ),
        ),
      );

    return row?.count ?? 0;
  }

  async countUnreadByConversationIds(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        conversationId: messages.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
          ne(messages.senderId, userId),
          or(
            isNull(conversationParticipants.lastReadMessageId),
            sql`(${messages.createdAt}, ${messages.id}) > (
              SELECT m.created_at, m.id
              FROM messages m
              WHERE m.id = ${conversationParticipants.lastReadMessageId}
            )`,
          ),
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(rows.map((row) => [row.conversationId, Number(row.count)]));
  }
}
