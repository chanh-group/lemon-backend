import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { created, updated, uuidV7 } from "../../utils/database.js";
import { messages } from "../message/schema.js";
import { users } from "../user/schema.js";

export const conversationKindEnum = pgEnum("conversation_kind", ["DIRECT", "GROUP"]);
export const participantRoleEnum = pgEnum("participant_role", ["MEMBER", "ADMIN", "OWNER"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuidV7("id").primaryKey(),
    kind: conversationKindEnum("kind").notNull().default("DIRECT"),
    directKey: text("direct_key"),
    title: text("title"),
    avatarUrl: text("avatar_url"),
    lastMessageId: uuid("last_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }),
    lastMessagePreview: text("last_message_preview"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: created("created_at"),
    updatedAt: updated("updated_at"),
  },
  (table) => [
    check(
      "conversations_direct_chk",
      sql`${table.kind} <> 'DIRECT' OR ${table.directKey} IS NOT NULL`,
    ),
    uniqueIndex("conversations_direct_key_uq")
      .on(table.directKey)
      .where(sql`${table.directKey} IS NOT NULL`),
    index("conversations_last_message_idx").on(table.lastMessageAt.desc()),
    index("conversations_active_idx")
      .on(table.lastMessageAt.desc())
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: participantRoleEnum("role").notNull().default("MEMBER"),
    lastReadMessageId: uuid("last_read_message_id"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: "date" }),
    mutedUntil: timestamp("muted_until", { withTimezone: true, mode: "date" }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index("participants_user_idx")
      .on(table.userId)
      .where(sql`${table.leftAt} IS NULL`),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;
