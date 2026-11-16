import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isUniqueViolation } from "../../utils/errors/pg.js";
import { messages } from "../message/schema.js";
import { users } from "../user/schema.js";
import type { ConversationRepository, ConversationWithPartner } from "./repository.js";
import { conversationParticipants, conversations } from "./schema.js";
import { canonicalPair, toCursorPage } from "../shared.js";
import { GROUP_MAX_MEMBERS } from "./constants.js";

const partnerParticipants = alias(conversationParticipants, "partner_participants");
const lastSender = alias(users, "last_message_sender");

function visiblePreview(userId: string) {
  const boundaryId = sql`(SELECT cp.history_boundary_message_id FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.user_id = ${userId}::uuid)`;
  return sql<string | null>`CASE WHEN ${boundaryId} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM messages boundary_msg
      WHERE boundary_msg.id = ${boundaryId}
        AND ROW(${conversations.lastMessageAt}, ${conversations.lastMessageId}) > ROW(boundary_msg.created_at, boundary_msg.id))
    THEN NULL ELSE CASE WHEN EXISTS (
    SELECT 1 FROM message_hidden_for_users h
    WHERE h.message_id = ${conversations.lastMessageId} AND h.user_id = ${userId}::uuid
  ) THEN (
    SELECT CASE
      WHEN m.deleted_at IS NOT NULL THEN '[message-revoked]'
      WHEN m.kind = 'STORY_REACTION' THEN '[story-reaction]'
      WHEN m.body IS NOT NULL AND m.body <> '' THEN left(m.body, 80)
      ELSE '[attachment]'
    END FROM messages m
    WHERE m.conversation_id = ${conversations.id}
      AND (${boundaryId} IS NULL OR ROW(m.created_at, m.id) >
        (SELECT bm.created_at, bm.id FROM messages bm WHERE bm.id = ${boundaryId}))
      AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users h
        WHERE h.message_id = m.id AND h.user_id = ${userId}::uuid)
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) ELSE ${conversations.lastMessagePreview} END END`;
}

function visibleSenderId(userId: string) {
  const boundaryId = sql`(SELECT cp.history_boundary_message_id FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.user_id = ${userId}::uuid)`;
  return sql<string | null>`CASE WHEN ${boundaryId} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM messages boundary_msg
      WHERE boundary_msg.id = ${boundaryId}
        AND ROW(${conversations.lastMessageAt}, ${conversations.lastMessageId}) > ROW(boundary_msg.created_at, boundary_msg.id))
    THEN NULL ELSE CASE WHEN EXISTS (
    SELECT 1 FROM message_hidden_for_users h
    WHERE h.message_id = ${conversations.lastMessageId} AND h.user_id = ${userId}::uuid
  ) THEN (
    SELECT m.sender_id FROM messages m
    WHERE m.conversation_id = ${conversations.id}
      AND (${boundaryId} IS NULL OR ROW(m.created_at, m.id) >
        (SELECT bm.created_at, bm.id FROM messages bm WHERE bm.id = ${boundaryId}))
      AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users h
        WHERE h.message_id = m.id AND h.user_id = ${userId}::uuid)
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) ELSE ${messages.senderId} END END`;
}

function visibleMessageAt(userId: string) {
  const boundaryId = sql`(SELECT cp.history_boundary_message_id FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.user_id = ${userId}::uuid)`;
  return sql<Date | null>`CASE WHEN ${boundaryId} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM messages boundary_msg
      WHERE boundary_msg.id = ${boundaryId}
        AND ROW(${conversations.lastMessageAt}, ${conversations.lastMessageId}) > ROW(boundary_msg.created_at, boundary_msg.id))
    THEN NULL ELSE CASE WHEN EXISTS (
    SELECT 1 FROM message_hidden_for_users h
    WHERE h.message_id = ${conversations.lastMessageId} AND h.user_id = ${userId}::uuid
  ) THEN (
    SELECT m.created_at FROM messages m
    WHERE m.conversation_id = ${conversations.id}
      AND (${boundaryId} IS NULL OR ROW(m.created_at, m.id) >
        (SELECT bm.created_at, bm.id FROM messages bm WHERE bm.id = ${boundaryId}))
      AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users h
        WHERE h.message_id = m.id AND h.user_id = ${userId}::uuid)
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) ELSE ${conversations.lastMessageAt} END END`.mapWith(conversations.lastMessageAt);
}

@Injectable()
export class ConversationPgRepository implements ConversationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  private getDirectKey(userAId: string, userBId: string): string {
    const [low, high] = canonicalPair(userAId, userBId);
    return `${low}:${high}`;
  }

  async createGroup(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
    clientRequestId: string;
    createRequestHash: string;
  }): Promise<ConversationWithPartner> {
    const [existing] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.creatorId, input.creatorId),
          eq(conversations.createRequestId, input.clientRequestId),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.deletedAt ||
        existing.title !== input.title ||
        existing.createRequestHash !== input.createRequestHash
      ) {
        throw new BusinessError("CONFLICT");
      }
      return (await this.findById(existing.id, input.creatorId))!;
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [group] = await tx
          .insert(conversations)
          .values({
            kind: "GROUP",
            title: input.title,
            creatorId: input.creatorId,
            createRequestId: input.clientRequestId,
            createRequestHash: input.createRequestHash,
          })
          .returning();
        await tx.insert(conversationParticipants).values([
          { conversationId: group.id, userId: input.creatorId, role: "ADMIN" },
          ...input.memberIds.map((userId) => ({
            conversationId: group.id,
            userId,
            role: "MEMBER" as const,
          })),
        ]);
        return {
          id: group.id,
          kind: "GROUP",
          directKey: null,
          title: group.title,
          avatarUrl: group.avatarUrl,
          memberCount: input.memberIds.length + 1,
          myRole: "ADMIN",
          lastMessagePreview: null,
          lastMessageAt: null,
          createdAt: group.createdAt,
        };
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err, "conversations_group_request_uq")) {
        const [retry] = await this.db
          .select({
            id: conversations.id,
            title: conversations.title,
            createRequestHash: conversations.createRequestHash,
            deletedAt: conversations.deletedAt,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.creatorId, input.creatorId),
              eq(conversations.createRequestId, input.clientRequestId),
            ),
          )
          .limit(1);
        if (
          retry &&
          !retry.deletedAt &&
          retry.title === input.title &&
          retry.createRequestHash === input.createRequestHash
        )
          return (await this.findById(retry.id, input.creatorId))!;
        throw new BusinessError("CONFLICT");
      }
      throw err;
    }
  }

  async addGroupMembers(
    conversationId: string,
    actorId: string,
    memberIds: string[],
  ): Promise<ConversationWithPartner> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update")
        .limit(1);
      if (!group || group.kind !== "GROUP" || group.deletedAt)
        throw new BusinessError("CONVERSATION_NOT_FOUND");
      const [actor] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, actorId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("update")
        .limit(1);
      if (actor?.role !== "ADMIN") throw new BusinessError("FORBIDDEN");
      const active = await tx
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      const activeSet = new Set(active.map(({ userId }) => userId));
      if (memberIds.some((id) => activeSet.has(id))) throw new BusinessError("CONFLICT");
      if (active.length + memberIds.length > GROUP_MAX_MEMBERS) {
        throw new BusinessError("GROUP_FULL");
      }
      await tx
        .insert(conversationParticipants)
        .values(
          memberIds.map((userId) => ({
            conversationId,
            userId,
            role: "MEMBER" as const,
            historyBoundaryMessageId: group.lastMessageId,
          })),
        )
        .onConflictDoUpdate({
          target: [conversationParticipants.conversationId, conversationParticipants.userId],
          set: {
            role: "MEMBER",
            joinedAt: sql`clock_timestamp()`,
            leftAt: null,
            lastReadMessageId: group.lastMessageId,
            lastReadAt: sql`clock_timestamp()`,
            historyBoundaryMessageId: group.lastMessageId,
          },
          where: sql`${conversationParticipants.leftAt} IS NOT NULL`,
        });
      await tx
        .update(conversations)
        .set({ unreadRevision: sql`${conversations.unreadRevision} + 1` })
        .where(eq(conversations.id, conversationId));
      return {
        id: conversationId,
        kind: "GROUP" as const,
        directKey: null,
        title: group.title,
        avatarUrl: group.avatarUrl,
        lastMessagePreview: group.lastMessagePreview,
        lastMessageAt: group.lastMessageAt,
        createdAt: group.createdAt,
        myRole: "MEMBER" as const,
        memberCount: active.length + memberIds.length,
      };
    });
  }

  async removeGroupMember(conversationId: string, actorId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({ kind: conversations.kind })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update")
        .limit(1);
      if (!group || group.kind !== "GROUP") throw new BusinessError("CONVERSATION_NOT_FOUND");
      const [actor] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, actorId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("update")
        .limit(1);
      const [target] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("update")
        .limit(1);
      if (actor?.role !== "ADMIN" || !target || actorId === userId)
        throw new BusinessError("FORBIDDEN");
      await tx
        .update(conversationParticipants)
        .set({ leftAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      await tx
        .update(conversations)
        .set({ unreadRevision: sql`${conversations.unreadRevision} + 1` })
        .where(eq(conversations.id, conversationId));
    });
  }

  async updateGroup(conversationId: string, actorId: string, title: string): Promise<void> {
    await this.updateGroupMetadata(conversationId, actorId, { title });
  }

  async updateGroupAvatar(
    conversationId: string,
    actorId: string,
    avatarUrl: string,
  ): Promise<void> {
    await this.updateGroupMetadata(conversationId, actorId, { avatarUrl });
  }

  async getGroupAvatarUrl(conversationId: string): Promise<string | null> {
    const [group] = await this.db
      .select({ avatarUrl: conversations.avatarUrl })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.kind, "GROUP"),
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);
    return group?.avatarUrl ?? null;
  }

  private async updateGroupMetadata(
    conversationId: string,
    actorId: string,
    changes: { title?: string; avatarUrl?: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update");
      const [actor] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, actorId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .limit(1);
      if (!actor) throw new BusinessError("NOT_PARTICIPANT");
      await tx
        .update(conversations)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.kind, "GROUP"),
            isNull(conversations.deletedAt),
          ),
        );
    });
  }

  async updateMemberRole(
    conversationId: string,
    actorId: string,
    userId: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update");
      const [actor] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, actorId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .limit(1);
      const [target] = await tx
        .select({ role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .limit(1);
      if (actor?.role !== "ADMIN" || !target || actorId === userId)
        throw new BusinessError("FORBIDDEN");
      await tx
        .update(conversationParticipants)
        .set({ role })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        );
    });
  }
  async leaveGroup(conversationId: string, userId: string): Promise<{ closed: boolean }> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update")
        .limit(1);
      if (!group || group.kind !== "GROUP") throw new BusinessError("CONVERSATION_NOT_FOUND");
      const active = await tx
        .select({ userId: conversationParticipants.userId, role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      const leaving = active.find((member) => member.userId === userId);
      if (!leaving) throw new BusinessError("NOT_PARTICIPANT");
      if (
        leaving.role === "ADMIN" &&
        active.length > 1 &&
        !active.some((member) => member.userId !== userId && member.role === "ADMIN")
      )
        throw new BusinessError("LAST_ADMIN_REQUIRED");
      await tx
        .update(conversationParticipants)
        .set({ leftAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId),
          ),
        );
      const closed = active.length === 1;
      await tx
        .update(conversations)
        .set({
          unreadRevision: sql`${conversations.unreadRevision} + 1`,
          ...(closed ? { deletedAt: sql`now()` } : {}),
        })
        .where(eq(conversations.id, conversationId));
      return { closed };
    });
  }

  async disbandGroup(conversationId: string, actorId: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({ kind: conversations.kind, deletedAt: conversations.deletedAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update")
        .limit(1);
      if (!group || group.kind !== "GROUP" || group.deletedAt)
        throw new BusinessError("CONVERSATION_NOT_FOUND");
      const active = await tx
        .select({ userId: conversationParticipants.userId, role: conversationParticipants.role })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      const actor = active.find((member) => member.userId === actorId);
      if (actor?.role !== "ADMIN") throw new BusinessError("FORBIDDEN");
      await tx
        .update(conversationParticipants)
        .set({ leftAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            isNull(conversationParticipants.leftAt),
          ),
        );
      await tx
        .update(conversations)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(conversations.id, conversationId));
      return active.map((member) => member.userId);
    });
  }

  async listMembers(conversationId: string) {
    return this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        role: conversationParticipants.role,
        joinedAt: conversationParticipants.joinedAt,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(users.id, conversationParticipants.userId))
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .orderBy(asc(conversationParticipants.joinedAt), asc(users.id));
  }

  async getGroupMembership(conversationId: string, userId: string) {
    const [row] = await this.db
      .select({
        role: conversationParticipants.role,
        historyBoundaryMessageId: conversationParticipants.historyBoundaryMessageId,
      })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async canAccessMessage(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: messages.id })
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
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          sql`(${conversationParticipants.historyBoundaryMessageId} IS NULL OR ROW(${messages.createdAt}, ${messages.id}) > (SELECT m.created_at, m.id FROM messages m WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}))`,
        ),
      )
      .limit(1);
    return Boolean(row);
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
        title: conversations.title,
        avatarUrl: conversations.avatarUrl,
        myRole: conversationParticipants.role,
        memberCount: sql<number>`(SELECT count(*)::int FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.left_at IS NULL)`,
        lastMessagePreview: visiblePreview(userAId),
        lastMessageSenderId: visibleSenderId(userAId),
        lastMessageSender: {
          id: lastSender.id,
          username: lastSender.username,
          fullName: lastSender.fullName,
          avatarUrl: lastSender.avatarUrl,
        },
        lastMessageAt: visibleMessageAt(userAId),
        createdAt: conversations.createdAt,
        partner: {
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(conversations)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, conversations.id),
          eq(conversationParticipants.userId, userAId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .innerJoin(users, eq(users.id, userBId))
      .leftJoin(messages, eq(conversations.lastMessageId, messages.id))
      .leftJoin(lastSender, eq(lastSender.id, visibleSenderId(userAId)))
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
          .where(and(eq(conversations.directKey, directKey), isNull(conversations.deletedAt)))
          .limit(1);

        let convId: string;
        let createdAt: Date;
        let lastMessagePreview: string | null = null;
        let lastMessageSenderId: string | null = null;
        let lastMessageAt: Date | null = null;

        if (existingConv) {
          convId = existingConv.id;
          createdAt = existingConv.createdAt;
          lastMessagePreview = existingConv.lastMessagePreview;
          lastMessageAt = existingConv.lastMessageAt;
          if (existingConv.lastMessageId) {
            const [lastMsg] = await tx
              .select({ senderId: messages.senderId })
              .from(messages)
              .where(eq(messages.id, existingConv.lastMessageId))
              .limit(1);
            lastMessageSenderId = lastMsg?.senderId ?? null;
          }
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
        const [participantLow, participantHigh] = canonicalPair(userAId, userBId);
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
          lastMessageSenderId,
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
        title: conversations.title,
        avatarUrl: conversations.avatarUrl,
        myRole: conversationParticipants.role,
        memberCount: sql<number>`(SELECT count(*)::int FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.left_at IS NULL)`,
        lastMessagePreview: visiblePreview(userId),
        lastMessageSenderId: visibleSenderId(userId),
        lastMessageSender: {
          id: lastSender.id,
          username: lastSender.username,
          fullName: lastSender.fullName,
          avatarUrl: lastSender.avatarUrl,
        },
        lastMessageAt: visibleMessageAt(userId),
        createdAt: conversations.createdAt,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
        unreadRevision: sql<string>`${conversations.unreadRevision}::text`,
      })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
      .leftJoin(messages, eq(conversations.lastMessageId, messages.id))
      .leftJoin(lastSender, eq(lastSender.id, visibleSenderId(userId)))
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
        lastMessagePreview: visiblePreview(userId),
        lastMessageSenderId: visibleSenderId(userId),
        lastMessageAt: visibleMessageAt(userId),
        createdAt: conversations.createdAt,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
        unreadRevision: sql<string>`${conversations.unreadRevision}::text`,
        partnerId: users.id,
        partnerUsername: users.username,
        partnerFullName: users.fullName,
        partnerAvatarUrl: users.avatarUrl,
        lastMessageSenderUserId: lastSender.id,
        lastMessageSenderUsername: lastSender.username,
        lastMessageSenderFullName: lastSender.fullName,
        lastMessageSenderAvatarUrl: lastSender.avatarUrl,
        title: conversations.title,
        avatarUrl: conversations.avatarUrl,
        myRole: conversationParticipants.role,
        memberCount: sql<number>`(SELECT count(*)::int FROM conversation_participants cp WHERE cp.conversation_id = ${conversations.id} AND cp.left_at IS NULL)`,
        historyBoundaryMessageId: conversationParticipants.historyBoundaryMessageId,
        lastReadAt: conversationParticipants.lastReadAt,
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
          eq(conversations.kind, "DIRECT"),
          eq(partnerParticipants.conversationId, conversations.id),
          ne(partnerParticipants.userId, userId),
          isNull(partnerParticipants.leftAt),
        ),
      )
      .leftJoin(users, eq(partnerParticipants.userId, users.id))
      .leftJoin(messages, eq(conversations.lastMessageId, messages.id))
      .leftJoin(lastSender, eq(lastSender.id, visibleSenderId(userId)))
      .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      kind: row.kind,
      directKey: row.directKey,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageSenderId: row.lastMessageSenderId,
      lastMessageSender:
        row.lastMessageSenderUserId &&
        row.lastMessageSenderUsername &&
        row.lastMessageSenderFullName
          ? {
              id: row.lastMessageSenderUserId,
              username: row.lastMessageSenderUsername,
              fullName: row.lastMessageSenderFullName,
              avatarUrl: row.lastMessageSenderAvatarUrl,
            }
          : undefined,
      lastMessageAt: row.lastMessageAt,
      title: row.title,
      avatarUrl: row.avatarUrl,
      myRole: row.myRole,
      memberCount: row.memberCount,
      historyBoundaryMessageId: row.historyBoundaryMessageId,
      lastReadAt: row.lastReadAt,
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
      unreadRevision: row.unreadRevision,
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
            OR ROW(
              (SELECT m.created_at FROM messages m WHERE m.id = ${messageId}),
              ${messageId}::uuid
            ) > ROW(
              (SELECT m.created_at FROM messages m WHERE m.id = ${conversationParticipants.lastReadMessageId}),
              ${conversationParticipants.lastReadMessageId}
            )
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
          isNull(conversationParticipants.leftAt),
        ),
      )
      .where(
        and(
          eq(messages.conversationId, conversationId),
          isNull(messages.deletedAt),
          ne(messages.senderId, userId),
          sql`NOT EXISTS (SELECT 1 FROM message_hidden_for_users h WHERE h.message_id = ${messages.id} AND h.user_id = ${userId}::uuid)`,
          sql`(${conversationParticipants.historyBoundaryMessageId} IS NULL OR ROW(${messages.createdAt}, ${messages.id}) > (SELECT m.created_at, m.id FROM messages m WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}))`,
          or(
            isNull(conversationParticipants.lastReadMessageId),
            sql`ROW(${messages.createdAt}, ${messages.id}) > ROW(
              (SELECT m.created_at FROM messages m WHERE m.id = ${conversationParticipants.lastReadMessageId}),
              ${conversationParticipants.lastReadMessageId}
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
          sql`NOT EXISTS (SELECT 1 FROM message_hidden_for_users h WHERE h.message_id = ${messages.id} AND h.user_id = ${userId}::uuid)`,
          sql`(${conversationParticipants.historyBoundaryMessageId} IS NULL OR ROW(${messages.createdAt}, ${messages.id}) > (SELECT m.created_at, m.id FROM messages m WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}))`,
          or(
            isNull(conversationParticipants.lastReadMessageId),
            sql`ROW(${messages.createdAt}, ${messages.id}) > ROW(
              (SELECT m.created_at FROM messages m WHERE m.id = ${conversationParticipants.lastReadMessageId}),
              ${conversationParticipants.lastReadMessageId}
            )`,
          ),
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(rows.map((row) => [row.conversationId, Number(row.count)]));
  }
}
