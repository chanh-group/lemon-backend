import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
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
export const participantRoleEnum = pgEnum("participant_role", ["MEMBER", "ADMIN"]);
export const avatarCleanupStatusEnum = pgEnum("avatar_cleanup_status", [
  "PENDING",
  "PROCESSING",
  "FAILED",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuidV7("id").primaryKey(),
    kind: conversationKindEnum("kind").notNull().default("DIRECT"),
    directKey: text("direct_key"),
    title: text("title"),
    avatarUrl: text("avatar_url"),
    creatorId: uuid("creator_id").references(() => users.id, { onDelete: "set null" }),
    createRequestId: uuid("create_request_id"),
    createRequestHash: text("create_request_hash"),
    lastMessageId: uuid("last_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }),
    lastMessagePreview: text("last_message_preview"),
    unreadRevision: bigint("unread_revision", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
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
    uniqueIndex("conversations_group_request_uq")
      .on(table.creatorId, table.createRequestId)
      .where(sql`${table.kind} = 'GROUP' AND ${table.createRequestId} IS NOT NULL`),
    index("conversations_inbox_order_idx")
      .on(sql`coalesce(${table.lastMessageAt}, ${table.createdAt}) DESC`, table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("conversations_direct_active_idx")
      .on(table.directKey)
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
    historyBoundaryMessageId: uuid("history_boundary_message_id").references(() => messages.id, {
      // A deleted boundary must fail the operation instead of silently
      // turning a late member into a full-history viewer.
      onDelete: "restrict",
    }),
    historyBoundaryWasEmpty: boolean("history_boundary_was_empty").notNull().default(false),
    joinGeneration: bigint("join_generation", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index("participants_user_idx")
      .on(table.userId)
      .where(sql`${table.leftAt} IS NULL`),
    index("participants_history_boundary_idx").on(table.historyBoundaryMessageId),
    index("participants_active_idx")
      .on(table.conversationId)
      .where(sql`${table.leftAt} IS NULL`),
  ],
);

export const avatarCleanupJobs = pgTable(
  "avatar_cleanup_jobs",
  {
    id: uuidV7("id").primaryKey(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    objectKey: text("object_key").notNull().unique(),
    status: avatarCleanupStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: created("created_at"),
    updatedAt: updated("updated_at"),
  },
  (table) => [index("avatar_cleanup_status_idx").on(table.status, table.createdAt)],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;
export type AvatarCleanupJob = typeof avatarCleanupJobs.$inferSelect;
export type NewAvatarCleanupJob = typeof avatarCleanupJobs.$inferInsert;
