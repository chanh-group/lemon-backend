import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isForeignKeyViolation, isUniqueViolation } from "../../utils/errors/pg.js";
import { conversations, conversationParticipants } from "../conversation/schema.js";
import { friendships } from "../friend/schema.js";
import { DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE } from "../pagination.constants.js";
import {
  ATTACHMENT_PREVIEW_TOKEN,
  MESSAGE_REVOKED_PREVIEW_TOKEN,
  STORY_REACTION_PREVIEW_TOKEN,
} from "./constants.js";
import type {
  AttachmentInsertData,
  CreatedMessageResult,
  MessageRepository,
  MessageTimelineResult,
  MessageWithAttachments,
} from "./repository.js";
import type { StoryPreview } from "../story/types.js";
import {
  type Message,
  type MessageAttachment,
  type MessageReaction,
  messageAttachments,
  messageReactions,
  messages,
} from "./schema.js";
import { groupReactions } from "./dto/mapper.js";
import type { MessageReactionSummary } from "./dto/response.js";

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

  async findByClientMsgId(
    conversationId: string,
    senderId: string,
    clientMsgId: string,
  ): Promise<MessageWithAttachments | null> {
    const [msg] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.senderId, senderId),
          eq(messages.clientMsgId, clientMsgId),
        ),
      )
      .limit(1);
    return msg ?? null;
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

        // 1. Idempotency check with clientMsgId
        if (messageData.clientMsgId) {
          const [existing] = await tx
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
          if (existing) {
            if (messageData.attachments && messageData.attachments.length > 0) {
              const existingAttachments = await tx
                .select()
                .from(messageAttachments)
                .where(eq(messageAttachments.messageId, existing.id));
              return { message: { ...existing, attachments: existingAttachments }, isNew: false };
            }
            return { message: existing, isNew: false };
          }
        }

        // 2. Insert new message
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
          })
          .returning();

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

        // 3. Atomically update parent conversation inbox fields
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
        const existing = await this.findByClientMsgId(
          messageData.conversationId,
          messageData.senderId,
          messageData.clientMsgId,
        );
        if (existing) return { message: existing, isNew: false };
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
    cursor?: string,
    limit = DEFAULT_MESSAGE_PAGE_SIZE,
    after?: string,
  ): Promise<MessageTimelineResult> {
    const queryLimit = Math.min(Math.max(limit, 1), MAX_MESSAGE_PAGE_SIZE);

    const conditions = [eq(messages.conversationId, conversationId), isNull(messages.deletedAt)];

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

    const rows = await this.db
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
      };
    }

    const messageIds = items.map((m) => m.id);
    const [attachmentRows, reactionRows] = await Promise.all([
      this.db
        .select()
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds)),
      this.db
        .select()
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, messageIds)),
    ]);

    const attachmentsByMessageId = new Map<string, MessageAttachment[]>();
    for (const att of attachmentRows) {
      const list = attachmentsByMessageId.get(att.messageId) ?? [];
      list.push(att);
      attachmentsByMessageId.set(att.messageId, list);
    }

    const reactionsByMessageId = new Map<string, MessageReaction[]>();
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
    };
  }

  async findReplyTargets(conversationId: string, messageIds: string[]): Promise<Message[]> {
    if (messageIds.length === 0) return [];
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), inArray(messages.id, messageIds)));
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
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.senderId, userId),
        ),
      )
      .limit(1);
    return msg ?? null;
  }

  async updateBody(messageId: string, senderId: string, body: string): Promise<Message | null> {
    return await this.db.transaction(async (tx) => {
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
    requiredFriendship?: { userAId: string; userBId: string },
  ): Promise<{ reactions: MessageReactionSummary[]; conversationId: string }> {
    return this.db.transaction(async (tx) => {
      if (requiredFriendship) {
        const [userLow, userHigh] = [requiredFriendship.userAId, requiredFriendship.userBId].sort();
        const [relation] = await tx
          .select({ status: friendships.status })
          .from(friendships)
          .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
          .for("share")
          .limit(1);
        if (relation?.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
        if (relation?.status !== "ACCEPTED") throw new BusinessError("FRIENDSHIP_REQUIRED");
      }

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
}
