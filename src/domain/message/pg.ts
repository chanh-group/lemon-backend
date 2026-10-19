import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { BusinessError } from "../../utils/errors/business.js";
import { isUniqueViolation } from "../../utils/errors/pg.js";
import { conversations } from "../conversation/schema.js";
import type {
  CreatedMessageResult,
  MessageRepository,
  MessageTimelineResult,
} from "./repository.js";
import { type Message, messages } from "./schema.js";

@Injectable()
export class MessagePgRepository implements MessageRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async findByClientMsgId(
    conversationId: string,
    senderId: string,
    clientMsgId: string,
  ): Promise<Message | null> {
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
    kind?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "SYSTEM";
    clientMsgId?: string | null;
    replyToId?: string | null;
  }): Promise<CreatedMessageResult> {
    try {
      return await this.db.transaction(async (tx) => {
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
          if (existing) return { message: existing, isNew: false };
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
          })
          .returning();

        // 3. Atomically update parent conversation inbox fields
        const preview = newMsg.body ? newMsg.body.slice(0, 80) : "[Tệp đính kèm]";
        await tx
          .update(conversations)
          .set({
            lastMessageId: newMsg.id,
            lastMessageAt: newMsg.createdAt,
            lastMessagePreview: preview,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, messageData.conversationId));

        return { message: newMsg, isNew: true };
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
      throw err;
    }
  }

  async findTimeline(
    conversationId: string,
    cursor?: string,
    limit = 30,
    after?: string,
  ): Promise<MessageTimelineResult> {
    const queryLimit = Math.min(Math.max(limit, 1), 50);

    const conditions = [eq(messages.conversationId, conversationId), isNull(messages.deletedAt)];

    if (cursor) {
      conditions.push(lt(messages.id, cursor));
    }

    if (after) {
      conditions.push(gt(messages.id, after));
    }

    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.id))
      .limit(queryLimit + 1);

    const hasMore = rows.length > queryLimit;
    const items = hasMore ? rows.slice(0, queryLimit) : rows;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : undefined;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  async findById(messageId: string): Promise<Message | null> {
    const [msg] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    return msg ?? null;
  }

  async updateBody(messageId: string, senderId: string, body: string): Promise<Message | null> {
    return await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(messages)
        .set({
          body,
          editedAt: new Date(),
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
      const preview = updated.body ? updated.body.slice(0, 80) : "[Tệp đính kèm]";
      await tx
        .update(conversations)
        .set({
          lastMessagePreview: preview,
          updatedAt: new Date(),
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
          deletedAt: new Date(),
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

      // Update conversation preview if this is the last message
      await tx
        .update(conversations)
        .set({
          lastMessagePreview: "Tin nhắn đã bị thu hồi",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, deleted.conversationId),
            eq(conversations.lastMessageId, messageId),
          ),
        );

      return deleted;
    });
  }
}
