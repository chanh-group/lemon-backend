import { describe, expect, it } from "vitest";
import {
  createDirectSchema,
  markReadSchema,
} from "../../../../src/domain/conversation/dto/request.js";

describe("Conversation DTOs", () => {
  describe("createDirectSchema", () => {
    it("accepts a valid UUID targetUserId", () => {
      const result = createDirectSchema.safeParse({
        targetUserId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a non-UUID string", () => {
      const result = createDirectSchema.safeParse({
        targetUserId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty string", () => {
      const result = createDirectSchema.safeParse({
        targetUserId: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing targetUserId", () => {
      const result = createDirectSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("markReadSchema", () => {
    it("accepts a valid UUID lastReadMessageId", () => {
      const result = markReadSchema.safeParse({
        lastReadMessageId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an invalid UUID lastReadMessageId", () => {
      const result = markReadSchema.safeParse({
        lastReadMessageId: "abc-123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing lastReadMessageId", () => {
      const result = markReadSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
