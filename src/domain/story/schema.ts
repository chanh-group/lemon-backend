import { sql } from "drizzle-orm";
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
} from "drizzle-orm/pg-core";
import { created, uuidV7 } from "../../utils/database.js";
import { users } from "../user/schema.js";
import { STORY_MAX_CAPTION_LENGTH } from "./constants.js";

export const storyKindEnum = pgEnum("story_kind", ["IMAGE", "VIDEO", "TEXT"]);

export const stories = pgTable(
  "stories",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: storyKindEnum("kind").notNull(),
    bucket: text("bucket"),
    objectKey: text("object_key"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    caption: text("caption"),
    background: text("background"),
    createdAt: created("created_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check("stories_media_chk", sql`${table.kind} = 'TEXT' OR ${table.objectKey} IS NOT NULL`),
    check(
      "stories_caption_len_chk",
      sql`${table.caption} IS NULL OR char_length(${table.caption}) <= ${sql.raw(String(STORY_MAX_CAPTION_LENGTH))}`,
    ),
    check(
      "stories_media_dims_chk",
      sql`${table.width} >= 0 AND ${table.height} >= 0 AND ${table.durationMs} >= 0`,
    ),
    check(
      "stories_expiry_chk",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + INTERVAL '25 hours'`,
    ),
    index("stories_user_idx").on(table.userId, table.createdAt.desc()),
    index("stories_expiry_idx").on(table.expiresAt),
  ],
);

export const storyViews = pgTable(
  "story_views",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index("story_views_viewer_idx").on(table.userId),
    index("story_views_story_cursor_idx").on(
      table.storyId,
      table.viewedAt.desc(),
      table.userId.desc(),
    ),
  ],
);

export const storyReactions = pgTable(
  "story_reactions",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: created("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index("story_reactions_story_idx").on(table.storyId),
    index("story_reactions_user_idx").on(table.userId),
  ],
);

export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryView = typeof storyViews.$inferSelect;
export type NewStoryView = typeof storyViews.$inferInsert;
export type StoryReaction = typeof storyReactions.$inferSelect;
export type NewStoryReaction = typeof storyReactions.$inferInsert;
