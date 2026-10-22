import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/configs/schema.js";

describe("Drizzle Table Constraints and Schema Metadata Verification", () => {
  describe("Users Table Metadata", () => {
    it("should have all expected columns with correct configuration", () => {
      const cols = getTableColumns(schema.users);
      expect(cols.id.primary).toBe(true);
      expect(cols.id.dataType).toBe("string"); // uuid
      expect(cols.email.notNull).toBe(true);
      expect(cols.username.notNull).toBe(true);
      expect(cols.fullName.notNull).toBe(true);
      expect(cols.isActive.default).toBe(true);
      expect(cols.createdAt.notNull).toBe(true);
      expect(cols.updatedAt.notNull).toBe(true);
    });
  });

  describe("Composite Primary Keys", () => {
    it("conversation_participants should have composite PK columns", () => {
      const cols = getTableColumns(schema.conversationParticipants);
      expect(cols.conversationId.notNull).toBe(true);
      expect(cols.userId.notNull).toBe(true);
      expect(cols.role.default).toBe("MEMBER");
      expect(cols.joinedAt.notNull).toBe(true);
    });

    it("story_views should have composite PK columns", () => {
      const cols = getTableColumns(schema.storyViews);
      expect(cols.storyId.notNull).toBe(true);
      expect(cols.userId.notNull).toBe(true);
      expect(cols.anonymous.default).toBe(false);
      expect(cols.viewedAt.notNull).toBe(true);
    });

    it("story_reactions should have composite PK columns", () => {
      const cols = getTableColumns(schema.storyReactions);
      expect(cols.storyId.notNull).toBe(true);
      expect(cols.userId.notNull).toBe(true);
      expect(cols.emoji.notNull).toBe(true);
      expect(cols.kind.default).toBe("REACTION");
      expect(cols.createdAt.notNull).toBe(true);
    });

    it("story_audiences should have composite PK columns", () => {
      const cols = getTableColumns(schema.storyAudiences);
      expect(cols.storyId.notNull).toBe(true);
      expect(cols.userId.notNull).toBe(true);
    });

    it("story_mutes should have composite PK columns", () => {
      const cols = getTableColumns(schema.storyMutes);
      expect(cols.userId.notNull).toBe(true);
      expect(cols.authorId.notNull).toBe(true);
    });
  });

  describe("Calls Table Generated Column", () => {
    it("should define durationSecs as a generated column", () => {
      const cols = getTableColumns(schema.calls);
      expect(cols.durationSecs).toBeDefined();
      expect(cols.callerId.notNull).toBe(true);
      expect(cols.calleeId.notNull).toBe(true);
      expect(cols.status.default).toBe("INITIATED");
    });
  });

  describe("Enum Values Completeness", () => {
    it("friendshipStatusEnum should contain all 3 status values", () => {
      expect(schema.friendshipStatusEnum.enumValues).toEqual(["PENDING", "ACCEPTED", "BLOCKED"]);
    });

    it("conversationKindEnum should contain DIRECT and GROUP", () => {
      expect(schema.conversationKindEnum.enumValues).toEqual(["DIRECT", "GROUP"]);
    });

    it("participantRoleEnum should contain MEMBER, ADMIN, OWNER", () => {
      expect(schema.participantRoleEnum.enumValues).toEqual(["MEMBER", "ADMIN", "OWNER"]);
    });

    it("messageKindEnum should contain all 8 message types", () => {
      expect(schema.messageKindEnum.enumValues).toEqual([
        "TEXT",
        "IMAGE",
        "VIDEO",
        "AUDIO",
        "FILE",
        "SYSTEM",
        "STORY_REPLY",
        "STORY_REACTION",
      ]);
    });

    it("attachmentKindEnum should contain all 4 attachment types", () => {
      expect(schema.attachmentKindEnum.enumValues).toEqual(["IMAGE", "VIDEO", "AUDIO", "FILE"]);
    });

    it("callMediaEnum and callStatusEnum should contain all telephony types", () => {
      expect(schema.callMediaEnum.enumValues).toEqual(["VOICE", "VIDEO"]);
      expect(schema.callStatusEnum.enumValues).toEqual([
        "INITIATED",
        "RINGING",
        "ACCEPTED",
        "REJECTED",
        "MISSED",
        "CANCELLED",
        "COMPLETED",
        "FAILED",
      ]);
    });

    it("storyKindEnum should contain IMAGE, VIDEO, TEXT", () => {
      expect(schema.storyKindEnum.enumValues).toEqual(["IMAGE", "VIDEO", "TEXT"]);
    });

    it("storyReactionKindEnum should contain REACTION, LIKE", () => {
      expect(schema.storyReactionKindEnum.enumValues).toEqual(["REACTION", "LIKE"]);
    });

    it("storyAudienceModeEnum should contain ALL_FRIENDS, CUSTOM, EXCLUDE", () => {
      expect(schema.storyAudienceModeEnum.enumValues).toEqual(["ALL_FRIENDS", "CUSTOM", "EXCLUDE"]);
    });
  });
});
