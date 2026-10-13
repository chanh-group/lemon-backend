import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../user/user.schema.js';

export const storyKindEnum = pgEnum('story_kind', ['IMAGE', 'VIDEO', 'TEXT']);

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: storyKindEnum('kind').notNull(),
    bucket: text('bucket'),
    objectKey: text('object_key'),
    mimeType: text('mime_type'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    caption: text('caption'),
    background: text('background'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    check(
      'stories_media_chk',
      sql`${table.kind} = 'TEXT' OR ${table.objectKey} IS NOT NULL`,
    ),
    check(
      'stories_expiry_chk',
      sql`${table.expiresAt} = ${table.createdAt} + INTERVAL '24 hours'`,
    ),
    index('stories_user_idx').on(table.userId, table.createdAt.desc()),
    index('stories_expiry_idx').on(table.expiresAt),
  ],
);

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index('story_views_story_idx').on(table.storyId),
  ],
);

export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryView = typeof storyViews.$inferSelect;
export type NewStoryView = typeof storyViews.$inferInsert;

