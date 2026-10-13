import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, timestamps } from '../../utils/database.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash'),
    googleId: text('google_id').unique(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    phone: text('phone').unique(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    check('users_username_format_chk', sql`${table.username} ~ '^[a-z0-9_]{3,30}$'`),
    check('users_full_name_chk', sql`char_length(btrim(${table.fullName})) BETWEEN 2 AND 100`),
    uniqueIndex('users_email_uq').on(table.email),
    uniqueIndex('users_username_uq').on(table.username),
    index('users_last_seen').on(table.lastSeenAt),
    index('users_active_idx').on(table.id).where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

