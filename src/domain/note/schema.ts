import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { created, uuidV7 } from "../../utils/database.js";
import { users } from "../user/schema.js";

export const notes = pgTable(
  "notes",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    background: text("background"),
    createdAt: created("created_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check("notes_content_len_chk", sql`char_length(${table.content}) BETWEEN 1 AND 200`),
    check("notes_background_len_chk", sql`char_length(${table.background}) <= 200`),
    uniqueIndex("notes_user_uq").on(table.userId),
    index("notes_expiry_idx").on(table.expiresAt),
  ],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
