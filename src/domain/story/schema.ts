import { sql } from "drizzle-orm";
import {
  boolean,
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
import { created, updated, uuidV7 } from "../../utils/database.js";
import { users } from "../user/schema.js";
import { STORY_MAX_CAPTION_LENGTH } from "./constants.js";

export const storyKindEnum = pgEnum("story_kind", ["IMAGE", "VIDEO", "TEXT"]);
export type StoryKind = (typeof storyKindEnum.enumValues)[number];
export const storyReactionKindEnum = pgEnum("story_reaction_kind", ["REACTION", "LIKE"]);
export const storyAudienceModeEnum = pgEnum("story_audience_mode", [
  "ALL_FRIENDS",
  "CUSTOM",
  "EXCLUDE",
]);

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
    allowReplies: boolean("allow_replies").notNull().default(true),
    allowReactions: boolean("allow_reactions").notNull().default(true),
    audienceMode: storyAudienceModeEnum("audience_mode").notNull().default("ALL_FRIENDS"),
    createdAt: created("created_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
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
    index("stories_archived_idx").on(table.archivedAt),
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
    anonymous: boolean("anonymous").notNull().default(false),
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
    kind: storyReactionKindEnum("kind").notNull().default("REACTION"),
    // `created_at` stays immutable: it is the moment the reaction was first
    // made and the stable sort key of the reaction list.
    // The opaque cursor serializes Date at millisecond precision.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date", precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: updated("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index("story_reactions_story_idx").on(table.storyId),
    index("story_reactions_user_idx").on(table.userId),
    index("story_reactions_story_cursor_idx").on(
      table.storyId,
      table.createdAt.desc(),
      table.userId.desc(),
    ),
  ],
);

export const userStorySettings = pgTable("user_story_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  viewedReceiptsEnabled: boolean("viewed_receipts_enabled").notNull().default(true),
  archiveEnabled: boolean("archive_enabled").notNull().default(true),
  archiveDurationSecs: integer("archive_duration_secs"),
  createdAt: created("created_at"),
  updatedAt: updated("updated_at"),
});

export const storyAudiences = pgTable(
  "story_audiences",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.storyId, table.userId] }),
    index("story_audiences_user_idx").on(table.userId),
    index("story_audiences_story_idx").on(table.storyId),
  ],
);

export const storyMutes = pgTable(
  "story_mutes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: created("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.authorId] }),
    index("story_mutes_user_idx").on(table.userId),
  ],
);

export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryView = typeof storyViews.$inferSelect;
export type NewStoryView = typeof storyViews.$inferInsert;
export type StoryReaction = typeof storyReactions.$inferSelect;
export type NewStoryReaction = typeof storyReactions.$inferInsert;
export type UserStorySettings = typeof userStorySettings.$inferSelect;
export type NewUserStorySettings = typeof userStorySettings.$inferInsert;
export type StoryAudience = typeof storyAudiences.$inferSelect;
export type NewStoryAudience = typeof storyAudiences.$inferInsert;
export type StoryMute = typeof storyMutes.$inferSelect;
export type NewStoryMute = typeof storyMutes.$inferInsert;
