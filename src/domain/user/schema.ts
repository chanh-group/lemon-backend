import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { citext, created, updated, uuidV7 } from "../../utils/database.js";
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "./constants.js";

export const users = pgTable(
  "users",
  {
    id: uuidV7("id").primaryKey(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash"),
    googleId: text("google_id"),
    username: text("username").notNull(),
    fullName: text("full_name").notNull(),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    phone: text("phone"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: created("created_at"),
    updatedAt: updated("updated_at"),
  },
  (table) => [
    check(
      "users_username_format_chk",
      sql`${table.username} ~ ${sql.raw(`'^[a-z0-9_]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$'`)}`,
    ),
    check(
      "users_full_name_chk",
      sql`char_length(btrim(${table.fullName})) BETWEEN ${sql.raw(String(FULL_NAME_MIN_LENGTH))} AND ${sql.raw(String(FULL_NAME_MAX_LENGTH))}`,
    ),
    uniqueIndex("users_email_uq")
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("users_username_uq")
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("users_google_id_uq")
      .on(table.googleId)
      .where(sql`${table.googleId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    uniqueIndex("users_phone_uq")
      .on(table.phone)
      .where(sql`${table.phone} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    index("users_username_trgm_idx")
      .using("gin", sql`${table.username} gin_trgm_ops`)
      .where(sql`${table.deletedAt} IS NULL`),
    index("users_email_trgm_idx")
      .using("gin", sql`(${table.email}::text) gin_trgm_ops`)
      .where(sql`${table.deletedAt} IS NULL`),
    index("users_last_seen").on(table.lastSeenAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
