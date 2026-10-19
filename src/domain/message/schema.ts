import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { created, uuidV7 } from "../../utils/database.js";
import { conversations } from "../conversation/schema.js";
import { stories } from "../story/schema.js";
import { users } from "../user/schema.js";
import { MESSAGE_MAX_BODY_LENGTH } from "./constants.js";

export interface StoryPreview {
  id: string;
  kind: "IMAGE" | "VIDEO" | "TEXT";
  bucket: string | null;
  objectKey: string | null;
  caption: string | null;
  background: string | null;
}

export const messageKindEnum = pgEnum("message_kind", [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "FILE",
  "SYSTEM",
]);

export const attachmentKindEnum = pgEnum("attachment_kind", ["IMAGE", "VIDEO", "AUDIO", "FILE"]);

export const messages = pgTable(
  "messages",
  {
    id: uuidV7("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: messageKindEnum("kind").notNull().default("TEXT"),
    body: text("body"),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    storyId: uuid("story_id").references(() => stories.id, {
      onDelete: "set null",
    }),
    storyPreview: jsonb("story_preview").$type<StoryPreview>(),
    clientMsgId: text("client_msg_id"),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: created("created_at"),
  },
  (table) => [
    check(
      "messages_content_chk",
      sql`${table.body} IS NOT NULL OR ${table.kind} IN ('IMAGE', 'VIDEO', 'AUDIO', 'FILE')`,
    ),
    check(
      "messages_body_len_chk",
      sql`${table.body} IS NULL OR char_length(${table.body}) <= ${sql.raw(String(MESSAGE_MAX_BODY_LENGTH))}`,
    ),
    uniqueIndex("messages_client_msg_uq")
      .on(table.conversationId, table.senderId, table.clientMsgId)
      .where(sql`${table.clientMsgId} IS NOT NULL`),
    index("messages_timeline_idx")
      .on(table.conversationId, table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("messages_sender_idx").on(table.senderId, table.id.desc()),
    index("messages_reply_idx").on(table.replyToId),
    index("messages_story_idx").on(table.storyId),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuidV7("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    kind: attachmentKindEnum("kind").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    checksum: text("checksum"),
    createdAt: created("created_at"),
  },
  (table) => [index("message_attachments_msg_idx").on(table.messageId)],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;
