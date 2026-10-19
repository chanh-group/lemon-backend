import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isUniqueViolation } from "../../utils/errors/pg.js";
import { users } from "../user/schema.js";
import type { ConversationRepository, ConversationWithPartner } from "./repository.js";
import { conversationParticipants, conversations } from "./schema.js";

@Injectable()
export class ConversationPgRepository implements ConversationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  private getDirectKey(userAId: string, userBId: string): string {
    const [low, high] = [userAId, userBId].sort();
    return `${low}:${high}`;
  }

  async findDirectByParticipants(
    userAId: string,
    userBId: string,
  ): Promise<ConversationWithPartner | null> {
    const directKey = this.getDirectKey(userAId, userBId);

    const [conv] = await this.db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        directKey: conversations.directKey,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(and(eq(conversations.directKey, directKey), isNull(conversations.deletedAt)))
      .limit(1);

    if (!conv) return null;

    // Fetch partner details
    const [partner] = await this.db
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
      ...conv,
      partner,
    };
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
        await tx
          .insert(conversationParticipants)
          .values([
            { conversationId: convId, userId: userAId, role: "MEMBER" },
            { conversationId: convId, userId: userBId, role: "MEMBER" },
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

  async findUserConversations(userId: string, limit = 20): Promise<ConversationWithPartner[]> {
    // 1. Get all conversations that this user participates in
    const myParticipations = await this.db
      .select({
        conversationId: conversationParticipants.conversationId,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
      })
      .from(conversationParticipants)
      .where(
        and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.leftAt)),
      );

    if (myParticipations.length === 0) return [];

    const convIds = myParticipations.map((p) => p.conversationId);
    const lastReadMap = new Map(
      myParticipations.map((p) => [p.conversationId, p.lastReadMessageId]),
    );

    // 2. Fetch conversations details
    const convRows = await this.db
      .select({
        id: conversations.id,
        kind: conversations.kind,
        directKey: conversations.directKey,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(and(inArray(conversations.id, convIds), isNull(conversations.deletedAt)))
      .orderBy(desc(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.createdAt})`))
      .limit(limit);

    // 3. For DIRECT conversations, find partner info
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
          inArray(conversationParticipants.conversationId, convIds),
          ne(conversationParticipants.userId, userId),
        ),
      );

    const partnerMap = new Map(otherParticipants.map((p) => [p.conversationId, p.user]));

    return convRows.map((conv) => ({
      ...conv,
      partner: partnerMap.get(conv.id),
      lastReadMessageId: lastReadMap.get(conv.id),
    }));
  }

  async findById(conversationId: string, userId: string): Promise<ConversationWithPartner | null> {
    const [membership] = await this.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    if (!membership) return null;

    const [conv] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .limit(1);

    if (!conv) return null;

    const [partnerRow] = await this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(conversationParticipants.userId, users.id))
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          ne(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);

    return {
      id: conv.id,
      kind: conv.kind,
      directKey: conv.directKey,
      lastMessagePreview: conv.lastMessagePreview,
      lastMessageAt: conv.lastMessageAt,
      createdAt: conv.createdAt,
      partner: partnerRow,
      lastReadMessageId: membership.lastReadMessageId,
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

  async updateLastRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.db
      .update(conversationParticipants)
      .set({
        lastReadMessageId: messageId,
        lastReadAt: new Date(),
      })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      );
  }
}
