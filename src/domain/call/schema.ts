import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidV7 } from "../../utils/database.js";
import { conversations } from "../conversation/schema.js";
import { users } from "../user/schema.js";

export const callMediaEnum = pgEnum("call_media", ["VOICE", "VIDEO"]);

export const callStatusEnum = pgEnum("call_status", [
  "INITIATED",
  "RINGING",
  "ACCEPTED",
  "REJECTED",
  "MISSED",
  "CANCELLED",
  "COMPLETED",
  "FAILED",
]);

export const calls = pgTable(
  "calls",
  {
    id: uuidV7("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calleeId: uuid("callee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    media: callMediaEnum("media").notNull(),
    status: callStatusEnum("status").notNull().default("INITIATED"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    endReason: text("end_reason"),
    durationSecs: integer("duration_secs").generatedAlwaysAs(
      sql`CASE WHEN answered_at IS NULL OR ended_at IS NULL THEN 0 ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ended_at - answered_at))))::INT END`,
    ),
  },
  (table) => [
    check("calls_no_self_chk", sql`${table.callerId} <> ${table.calleeId}`),
    index("calls_conv_idx").on(table.conversationId, table.startedAt.desc()),
    index("calls_caller_idx").on(table.callerId, table.status, table.startedAt.desc()),
    index("calls_callee_idx").on(table.calleeId, table.status, table.startedAt.desc()),
  ],
);

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
