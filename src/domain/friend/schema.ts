import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { created, updated, uuidV7 } from "../../utils/database.js";
import { users } from "../user/schema.js";

export const friendshipStatusEnum = pgEnum("friendship_status", ["PENDING", "ACCEPTED", "BLOCKED"]);

export const friendships = pgTable(
  "friendships",
  {
    id: uuidV7("id").primaryKey(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").notNull().default("PENDING"),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
    createdAt: created("created_at"),
    updatedAt: updated("updated_at"),
  },
  (table) => [
    check("friendships_no_self_chk", sql`${table.requesterId} <> ${table.addresseeId}`),
    check("friendships_pair_chk", sql`${table.userLow} < ${table.userHigh}`),
    unique("friendships_pair_uq").on(table.userLow, table.userHigh),
    index("friendships_addressee_idx").on(table.addresseeId, table.status, table.requesterId),
    index("friendships_requester_idx").on(table.requesterId, table.status, table.addresseeId),
    index("friendships_low_idx")
      .on(table.userLow)
      .where(sql`${table.status} = 'ACCEPTED'`),
    index("friendships_high_idx")
      .on(table.userHigh)
      .where(sql`${table.status} = 'ACCEPTED'`),
  ],
);

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;
