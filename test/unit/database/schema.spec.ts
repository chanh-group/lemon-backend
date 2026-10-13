import { getTableColumns } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/configs/schema.js";

describe("Database Schema Exports", () => {
  it("should export all 10 domain tables", () => {
    expect(schema.users).toBeDefined();
    expect(schema.friendships).toBeDefined();
    expect(schema.conversations).toBeDefined();
    expect(schema.conversationParticipants).toBeDefined();
    expect(schema.messages).toBeDefined();
    expect(schema.messageAttachments).toBeDefined();
    expect(schema.calls).toBeDefined();
    expect(schema.stories).toBeDefined();
    expect(schema.storyViews).toBeDefined();
    expect(schema.notes).toBeDefined();
  });

  it("should export all 8 enums", () => {
    expect(schema.friendshipStatusEnum).toBeDefined();
    expect(schema.conversationKindEnum).toBeDefined();
    expect(schema.participantRoleEnum).toBeDefined();
    expect(schema.messageKindEnum).toBeDefined();
    expect(schema.attachmentKindEnum).toBeDefined();
    expect(schema.callMediaEnum).toBeDefined();
    expect(schema.callStatusEnum).toBeDefined();
    expect(schema.storyKindEnum).toBeDefined();
  });

  it("should export custom types and helpers", () => {
    expect(schema.citext).toBeDefined();
    expect(schema.created).toBeDefined();
    expect(schema.updated).toBeDefined();
    expect(schema.uuidV7).toBeDefined();
  });

  describe("created / updated helpers", () => {
    it("should create notNull timestamp columns with defaultNow", () => {
      const t = pgTable("t_ts_check", {
        createdAt: schema.created("created_at"),
        updatedAt: schema.updated("updated_at"),
      });
      const cols = getTableColumns(t);
      expect(cols.createdAt.notNull).toBe(true);
      expect(cols.updatedAt.notNull).toBe(true);
      expect(cols.createdAt.hasDefault).toBe(true);
      expect(cols.updatedAt.hasDefault).toBe(true);
    });
  });

  describe("uuidV7 helper", () => {
    it("should default to valid RFC 9562 UUIDv7 strings", () => {
      const t = pgTable("t_uuid_check", { id: schema.uuidV7("id").primaryKey() });
      const cols = getTableColumns(t);
      const gen = cols.id.defaultFn as unknown as () => string;
      expect(typeof gen).toBe("function");
      expect(gen()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });
});
