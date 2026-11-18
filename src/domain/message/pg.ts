import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isForeignKeyViolation, isUniqueViolation } from "../../utils/errors/pg.js";
import { conversations, conversationParticipants } from "../conversation/schema.js";
import { users } from "../user/schema.js";
import { friendships } from "../friend/schema.js";
import { DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE } from "../pagination.constants.js";
import {
  ATTACHMENT_PREVIEW_TOKEN,
  MESSAGE_REVOKED_PREVIEW_TOKEN,
  STORY_REACTION_PREVIEW_TOKEN,
} from "./constants.js";
import type {
  AttachmentInsertData,
  AttachmentResponseSource,
  CreatedMessageResult,
  MessageRepository,
  MessageTimelineResult,
  MessageWithAttachments,
  ReactionResponseSource,
  ReplyTargetMessage,
} from "./repository.js";
import type { StoryPreview } from "../story/types.js";
import {
  type Message,
  type MessageAttachment,
  messageAttachments,
  messageHiddenForUsers,
  messageReactions,
  messages,
} from "./schema.js";
import { groupReactions } from "./dto/mapper.js";
import type { MessageReactionSummary } from "./dto/response.js";

/** Transaction handle handed to `db.transaction` callbacks. */
type DbTx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * Conversation inbox preview. A story reaction carries the emoji as its body,
 * which is meaningless out of context — it is stored as a stable marker the
 * client localizes, like the attachment marker.
 */
function toConversationPreview(kind: Message["kind"], body: string | null): string {
  if (kind === "STORY_REACTION") return STORY_REACTION_PREVIEW_TOKEN;
  return body ? body.slice(0, 80) : ATTACHMENT_PREVIEW_TOKEN;
}

@Injectable()
export class MessagePgRepository implements MessageRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async findSenderProfiles(senderIds: string[]) {
    if (senderIds.length === 0) return [];
    return this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(inArray(users.id, [...new Set(senderIds)]));
  }

  private async findExistingByClientMsgId(
    db: Pick<DrizzleDb, "select">,
    messageData: {
      conversationId: string;
      senderId: string;
      clientMsgId: string;
    },
  ): Promise<CreatedMessageResult | null> {
    const [existing] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, messageData.conversationId),
          eq(messages.senderId, messageData.senderId),
          eq(messages.clientMsgId, messageData.clientMsgId),
        ),
      )
      .limit(1);
    if (!existing) return null;
    const existingAttachments = await db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, existing.id));
    return { message: { ...existing, attachments: existingAttachments }, isNew: false };
  }

  async createMessageWithConversationUpdate(messageData: {
    conversationId: string;
    senderId: string;
    body?: string | null;
    kind?:
      | "TEXT"
      | "IMAGE"
      | "VIDEO"
      | "AUDIO"
      | "FILE"
      | "SYSTEM"
      | "STORY_REPLY"
      | "STORY_REACTION";
    clientMsgId?: string | null;
    replyToId?: string | null;
    requiredFriendship?: { userAId: string; userBId: string };
    storyId?: string | null;
    storyPreview?: StoryPreview | null;
    attachments?: AttachmentInsertData[];
    isForwarded?: boolean;
  }): Promise<CreatedMessageResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [conversation] = await tx
          .select({ kind: conversations.kind })
          .from(conversations)
          .where(eq(conversations.id, messageData.conversationId))
          .for("update")
          .limit(1);
        if (!conversation) throw new BusinessError("CONVERSATION_NOT_FOUND");
        const [participant] = await tx
          .select({ leftAt: conversationParticipants.leftAt })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, messageData.conversationId),
              eq(conversationParticipants.userId, messageData.senderId),
            ),
          )
          .for("share")
          .limit(1);
        if (!participant || participant.leftAt) throw new BusinessError("NOT_PARTICIPANT");
        if (messageData.requiredFriendship) {
          const [userLow, userHigh] = [
            messageData.requiredFriendship.userAId,
            messageData.requiredFriendship.userBId,
          ].sort();
          const [relation] = await tx
            .select({ status: friendships.status })
            .from(friendships)
            .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
            .for("share")
            .limit(1);

          if (relation?.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
          if (relation?.status !== "ACCEPTED") throw new BusinessError("FRIENDSHIP_REQUIRED");
        }

        // 1. Insert the message. The partial unique index on clientMsgId
        // swallows duplicate retries, so the happy path skips a pre-check
        // round trip; a swallowed insert resolves the existing row below.
        const [newMsg] = await tx
          .insert(messages)
          .values({
            conversationId: messageData.conversationId,
            senderId: messageData.senderId,
            body: messageData.body ?? null,
            kind: messageData.kind ?? "TEXT",
            clientMsgId: messageData.clientMsgId ?? null,
            replyToId: messageData.replyToId ?? null,
            storyId: messageData.storyId ?? null,
            storyPreview: messageData.storyPreview ?? null,
            isForwarded: messageData.isForwarded ?? false,
            createdAt: sql`GREATEST(clock_timestamp(), COALESCE((SELECT MAX(created_at) + interval '1 microsecond' FROM messages WHERE conversation_id = ${messageData.conversationId}), clock_timestamp()))`,
          })
          .onConflictDoNothing({
            target: [messages.conversationId, messages.senderId, messages.clientMsgId],
            where: sql`${messages.clientMsgId} IS NOT NULL`,
          })
          .returning();

        if (!newMsg) {
          if (messageData.clientMsgId) {
            const existing = await this.findExistingByClientMsgId(tx, {
              conversationId: messageData.conversationId,
              senderId: messageData.senderId,
              clientMsgId: messageData.clientMsgId,
            });
            if (existing) return existing;
          }
          throw new BusinessError("CONFLICT");
        }

        let insertedAttachments: MessageAttachment[] | undefined;
        if (messageData.attachments && messageData.attachments.length > 0) {
          insertedAttachments = await tx
            .insert(messageAttachments)
            .values(
              messageData.attachments.map((att) => ({
                messageId: newMsg.id,
                kind: att.kind ?? "FILE",
                bucket: att.bucket,
                objectKey: att.objectKey,
                fileName: att.fileName,
                mimeType: att.mimeType,
                sizeBytes: att.sizeBytes,
                width: att.width ?? null,
                height: att.height ?? null,
                durationMs: att.durationMs ?? null,
                checksum: att.checksum ?? null,
              })),
            )
            .returning();
        }

        // 2. Atomically update parent conversation inbox fields
        const preview = toConversationPreview(newMsg.kind, newMsg.body);
        const isLatest = sql`(${conversations.lastMessageAt} IS NULL
          OR ${conversations.lastMessageAt} < ${newMsg.createdAt}
          OR (${conversations.lastMessageAt} = ${newMsg.createdAt}
            AND ${conversations.lastMessageId} < ${newMsg.id}::uuid))`;
        await tx
          .update(conversations)
          .set({
            unreadRevision: sql`${conversations.unreadRevision} + 1`,
            lastMessageId: sql`CASE WHEN ${isLatest} THEN ${newMsg.id}::uuid ELSE ${conversations.lastMessageId} END`,
            lastMessageAt: sql`CASE WHEN ${isLatest} THEN ${newMsg.createdAt}::timestamptz ELSE ${conversations.lastMessageAt} END`,
            lastMessagePreview: sql`CASE WHEN ${isLatest} THEN ${preview} ELSE ${conversations.lastMessagePreview} END`,
            updatedAt: sql`CASE WHEN ${isLatest} THEN now() ELSE ${conversations.updatedAt} END`,
          })
          .where(eq(conversations.id, messageData.conversationId));

        return {
          message: insertedAttachments ? { ...newMsg, attachments: insertedAttachments } : newMsg,
          isNew: true,
        };
      });
    } catch (err: unknown) {
      if (messageData.clientMsgId && isUniqueViolation(err, "messages_client_msg_uq")) {
        const existing = await this.findExistingByClientMsgId(this.db, {
          conversationId: messageData.conversationId,
          senderId: messageData.senderId,
          clientMsgId: messageData.clientMsgId,
        });
        if (existing) return existing;
        throw new BusinessError("CONFLICT");
      }
      if (isForeignKeyViolation(err)) {
        throw new BusinessError("BAD_REQUEST");
      }
      throw err;
    }
  }

  async findTimeline(
    conversationId: string,
    viewerId: string,
    cursor?: string,
    limit = DEFAULT_MESSAGE_PAGE_SIZE,
    after?: string,
  ): Promise<MessageTimelineResult> {
    const queryLimit = Math.min(Math.max(limit, 1), MAX_MESSAGE_PAGE_SIZE);

    if (!viewerId) return { items: [], hasMore: false, authorized: false };

    const [membership] = await this.db
      .select({ id: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, viewerId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .limit(1);
    if (!membership) {
      return { items: [], hasMore: false, authorized: false };
    }

    const conditions = [
      eq(messages.conversationId, conversationId),
      notExists(
        this.db
          .select({ messageId: messageHiddenForUsers.messageId })
          .from(messageHiddenForUsers)
          .where(
            and(
              eq(messageHiddenForUsers.messageId, messages.id),
              eq(messageHiddenForUsers.userId, viewerId),
            ),
          ),
      ),
      sql`(
        (
          ${conversationParticipants.historyBoundaryMessageId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM messages boundary_message
            WHERE boundary_message.id = ${conversationParticipants.historyBoundaryMessageId}
              AND boundary_message.conversation_id = ${conversationId}
          )
          AND ROW(${messages.createdAt}, ${messages.id}) > (
            SELECT m.created_at, m.id FROM messages m
            WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}
              AND m.conversation_id = ${conversationId}
          )
        )
        OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = true)
        OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = false AND ${messages.createdAt} > ${conversationParticipants.joinedAt})
      )`,
    ];

    if (cursor) {
      const cursorCreatedAt = sql`(
        SELECT m.created_at FROM messages m
        WHERE m.id = ${cursor} AND m.conversation_id = ${conversationId}
      )`;
      conditions.push(
        or(
          lt(messages.createdAt, cursorCreatedAt),
          and(eq(messages.createdAt, cursorCreatedAt), lt(messages.id, cursor)),
        )!,
      );
    }

    if (after) {
      const afterCreatedAt = sql`(
        SELECT m.created_at FROM messages m
        WHERE m.id = ${after} AND m.conversation_id = ${conversationId}
      )`;
      conditions.push(
        or(
          gt(messages.createdAt, afterCreatedAt),
          and(eq(messages.createdAt, afterCreatedAt), gt(messages.id, after)),
        )!,
      );
    }

    const rows = viewerId
      ? (
          await this.db
            .select({ message: messages })
            .from(messages)
            .innerJoin(
              conversationParticipants,
              and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, viewerId),
                isNull(conversationParticipants.leftAt),
              ),
            )
            .where(and(...conditions))
            .orderBy(
              after ? asc(messages.createdAt) : desc(messages.createdAt),
              after ? asc(messages.id) : desc(messages.id),
            )
            .limit(queryLimit + 1)
        ).map(({ message }) => message)
      : await this.db
          .select()
          .from(messages)
          .where(and(...conditions))
          .orderBy(
            after ? asc(messages.createdAt) : desc(messages.createdAt),
            after ? asc(messages.id) : desc(messages.id),
          )
          .limit(queryLimit + 1);

    const hasMore = rows.length > queryLimit;
    const items = hasMore ? rows.slice(0, queryLimit) : rows;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : undefined;

    if (items.length === 0) {
      return {
        items: [],
        nextCursor,
        hasMore,
        authorized: true,
      };
    }

    const messageIds = items.filter((m) => !m.deletedAt).map((m) => m.id);
    if (messageIds.length === 0) return { items, nextCursor, hasMore, authorized: true };
    const [attachmentRows, reactionRows] = await Promise.all([
      this.db
        .select({
          id: messageAttachments.id,
          messageId: messageAttachments.messageId,
          kind: messageAttachments.kind,
          objectKey: messageAttachments.objectKey,
          fileName: messageAttachments.fileName,
          mimeType: messageAttachments.mimeType,
          sizeBytes: messageAttachments.sizeBytes,
          width: messageAttachments.width,
          height: messageAttachments.height,
          durationMs: messageAttachments.durationMs,
        })
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds)),
      this.db
        .select({
          messageId: messageReactions.messageId,
          userId: messageReactions.userId,
          emoji: messageReactions.emoji,
        })
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds)),
    ]);

    const attachmentsByMessageId = new Map<string, AttachmentResponseSource[]>();
    for (const att of attachmentRows) {
      const list = attachmentsByMessageId.get(att.messageId) ?? [];
      list.push(att);
      attachmentsByMessageId.set(att.messageId, list);
    }

    const reactionsByMessageId = new Map<string, ReactionResponseSource[]>();
    for (const r of reactionRows) {
      const list = reactionsByMessageId.get(r.messageId) ?? [];
      list.push(r);
      reactionsByMessageId.set(r.messageId, list);
    }

    const itemsWithAttachments = items.map((m) => ({
      ...m,
      attachments: attachmentsByMessageId.get(m.id) ?? [],
      reactions: reactionsByMessageId.get(m.id) ?? [],
    }));

    return {
      items: itemsWithAttachments,
      nextCursor,
      hasMore,
      authorized: true,
    };
  }

  async hideForUser(
    messageId: string,
    userId: string,
  ): Promise<{ conversationId: string; inserted: boolean }> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message) throw new BusinessError("MESSAGE_NOT_FOUND");

      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, message.conversationId), isNull(conversations.deletedAt)))
        .for("update")
        .limit(1);
      if (!conversation) throw new BusinessError("MESSAGE_NOT_FOUND");
      const [participant] = await tx
        .select({
          historyBoundaryMessageId: conversationParticipants.historyBoundaryMessageId,
          joinedAt: conversationParticipants.joinedAt,
        })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, message.conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!participant) throw new BusinessError("MESSAGE_NOT_FOUND");

      // Re-check the message after taking the conversation/participant locks.
      // Do not exclude an existing hidden row: DELETE /for-me is idempotent.
      const [eligible] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.conversationId, message.conversationId),
            participant.historyBoundaryMessageId
              ? sql`ROW(${messages.createdAt}, ${messages.id}) > (
                SELECT boundary.created_at, boundary.id FROM messages boundary
                WHERE boundary.id = ${participant.historyBoundaryMessageId}
                  AND boundary.conversation_id = ${message.conversationId}
              )`
              : gt(messages.createdAt, participant.joinedAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!eligible) throw new BusinessError("MESSAGE_NOT_FOUND");

      const [inserted] = await tx
        .insert(messageHiddenForUsers)
        .values({ messageId, userId })
        .onConflictDoNothing()
        .returning({ messageId: messageHiddenForUsers.messageId });
      if (inserted) {
        await tx
          .update(conversations)
          .set({ unreadRevision: sql`${conversations.unreadRevision} + 1` })
          .where(eq(conversations.id, message.conversationId));
      }
      return { conversationId: message.conversationId, inserted: Boolean(inserted) };
    });
  }

  async findReplyTargets(
    conversationId: string,
    messageIds: string[],
    viewerId: string,
  ): Promise<ReplyTargetMessage[]> {
    if (messageIds.length === 0 || !viewerId) return [];

    return this.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        kind: messages.kind,
        body: messages.body,
        deletedAt: messages.deletedAt,
        storyPreview: messages.storyPreview,
      })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, viewerId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.id, messageIds),
          notExists(
            this.db
              .select({ messageId: messageHiddenForUsers.messageId })
              .from(messageHiddenForUsers)
              .where(
                and(
                  eq(messageHiddenForUsers.messageId, messages.id),
                  eq(messageHiddenForUsers.userId, viewerId),
                ),
              ),
          ),
          sql`(
            (
              ${conversationParticipants.historyBoundaryMessageId} IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM messages boundary_message
                WHERE boundary_message.id = ${conversationParticipants.historyBoundaryMessageId}
                  AND boundary_message.conversation_id = ${conversationId}
              )
              AND ROW(${messages.createdAt}, ${messages.id}) > (
                SELECT m.created_at, m.id FROM messages m
                WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}
                  AND m.conversation_id = ${conversationId}
              )
            )
            OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = true)
            OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = false AND ${messages.createdAt} > ${conversationParticipants.joinedAt})
          )`,
        ),
      );
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
          sql`(
            (${conversationParticipants.historyBoundaryMessageId} IS NOT NULL AND ROW(${messages.createdAt}, ${messages.id}) > (
              SELECT m.created_at, m.id FROM messages m
              WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}
                AND m.conversation_id = ${conversationParticipants.conversationId}
            ))
            OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = true)
            OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = false AND ${messages.createdAt} > ${conversationParticipants.joinedAt})
          )`,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async findById(messageId: string, includeDetails = true): Promise<MessageWithAttachments | null> {
    const [msg] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!msg) return null;
    if (!includeDetails) return msg;
    const [attachments, reactions] = await Promise.all([
      this.db.select().from(messageAttachments).where(eq(messageAttachments.messageId, messageId)),
      this.db.select().from(messageReactions).where(eq(messageReactions.messageId, messageId)),
    ]);
    return { ...msg, attachments, reactions };
  }

  async resolveWriteMiss(
    messageId: string,
    userId: string,
    conversationId: string,
  ): Promise<Message | null> {
    const [msg] = await this.db
      .select({ message: messages })
      .from(messages)
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, messages.conversationId),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
          sql`(
            (
              ${conversationParticipants.historyBoundaryMessageId} IS NOT NULL
              AND ROW(${messages.createdAt}, ${messages.id}) > (
              SELECT m.created_at, m.id
              FROM messages m
              WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}
                AND m.conversation_id = ${conversationParticipants.conversationId}
              )
            )
            OR (
              ${conversationParticipants.historyBoundaryMessageId} IS NULL
              AND ${conversationParticipants.historyBoundaryWasEmpty} = true
            )
            OR (
              ${conversationParticipants.historyBoundaryMessageId} IS NULL
              AND ${conversationParticipants.historyBoundaryWasEmpty} = false
              AND ${messages.createdAt} > ${conversationParticipants.joinedAt}
            )
          )`,
        ),
      )
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.senderId, userId),
        ),
      )
      .limit(1);
    return msg?.message ?? null;
  }

  async updateBody(messageId: string, senderId: string, body: string): Promise<Message | null> {
    return await this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message) return null;
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, message.conversationId))
        .for("update")
        .limit(1);
      const [participant] = await tx
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, message.conversationId),
            eq(conversationParticipants.userId, senderId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!participant) return null;

      const [updated] = await tx
        .update(messages)
        .set({
          body,
          editedAt: sql`now()`,
        })
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.senderId, senderId),
            isNull(messages.deletedAt),
          ),
        )
        .returning();

      if (!updated) return null;

      // Update conversation preview if this is the last message
      const preview = updated.body ? updated.body.slice(0, 80) : ATTACHMENT_PREVIEW_TOKEN;
      await tx
        .update(conversations)
        .set({
          lastMessagePreview: preview,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(conversations.id, updated.conversationId),
            eq(conversations.lastMessageId, messageId),
          ),
        );

      return updated;
    });
  }

  async softDelete(messageId: string, senderId: string): Promise<Message | null> {
    return await this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (!message) return null;
      await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, message.conversationId))
        .for("update")
        .limit(1);
      const [participant] = await tx
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, message.conversationId),
            eq(conversationParticipants.userId, senderId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!participant) return null;

      const [deleted] = await tx
        .update(messages)
        .set({
          deletedAt: sql`now()`,
        })
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.senderId, senderId),
            isNull(messages.deletedAt),
          ),
        )
        .returning();

      if (!deleted) return null;

      // A revoked message changes unread counts even when it is not the last message.
      await tx
        .update(conversations)
        .set({
          unreadRevision: sql`${conversations.unreadRevision} + 1`,
          lastMessagePreview: sql`CASE WHEN ${conversations.lastMessageId} = ${messageId}::uuid THEN ${MESSAGE_REVOKED_PREVIEW_TOKEN} ELSE ${conversations.lastMessagePreview} END`,
          updatedAt: sql`CASE WHEN ${conversations.lastMessageId} = ${messageId}::uuid THEN now() ELSE ${conversations.updatedAt} END`,
        })
        .where(eq(conversations.id, deleted.conversationId));

      return deleted;
    });
  }

  async reactMessage(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ reactions: MessageReactionSummary[]; conversationId: string }> {
    return this.db.transaction(async (tx) => {
      const [msg] = await tx
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(eq(messages.id, messageId))
        .for("update")
        .limit(1);

      if (!msg || msg.deletedAt) throw new BusinessError("MESSAGE_NOT_FOUND");

      const [participant] = await tx
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, msg.conversationId),
            eq(conversationParticipants.userId, userId),
            isNull(conversationParticipants.leftAt),
          ),
        )
        .for("share")
        .limit(1);

      if (!participant) throw new BusinessError("NOT_PARTICIPANT");

      await this.assertDirectReactionAllowed(tx, msg.conversationId, userId);

      const [existing] = await tx
        .select()
        .from(messageReactions)
        .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)))
        .limit(1);

      if (existing && existing.emoji === emoji) {
        await tx
          .delete(messageReactions)
          .where(
            and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)),
          );
      } else {
        await tx
          .insert(messageReactions)
          .values({ messageId, userId, emoji })
          .onConflictDoUpdate({
            target: [messageReactions.messageId, messageReactions.userId],
            set: { emoji, createdAt: sql`now()` },
          });
      }

      const allReactions = await tx
        .select({ emoji: messageReactions.emoji, userId: messageReactions.userId })
        .from(messageReactions)
        .where(eq(messageReactions.messageId, messageId));

      return {
        reactions: groupReactions(allReactions) ?? [],
        conversationId: msg.conversationId,
      };
    });
  }

  /**
   * Direct conversations gate reactions on the accepted friendship, checked
   * under the transaction lock. The pair is derived from the conversation so
   * the locked message select stays the single source of truth.
   */
  private async assertDirectReactionAllowed(
    tx: DbTx,
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const [conversation] = await tx
      .select({ kind: conversations.kind })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (conversation?.kind !== "DIRECT") return;

    const [partner] = await tx
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          ne(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .limit(1);
    if (!partner) return;

    const [userLow, userHigh] = [userId, partner.userId].sort();
    const [relation] = await tx
      .select({ status: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
      .for("share")
      .limit(1);
    if (relation?.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
    if (relation?.status !== "ACCEPTED") throw new BusinessError("FRIENDSHIP_REQUIRED");
  }
}
