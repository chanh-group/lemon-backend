import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createDirectSchema,
  markReadSchema,
} from "../../../../src/domain/conversation/dto/request.js";

function messagesFor(schema: z.ZodType, input: unknown, path?: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => (path === undefined ? true : issue.path.join(".") === path))
    .map((issue) => issue.message);
}

describe("Conversation DTOs", () => {
  describe("createDirectSchema", () => {
    it("accepts a valid UUID targetUserId", () => {
      const result = createDirectSchema.safeParse({
        targetUserId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a non-UUID string with the VALIDATION_UUID_TARGET_USER key", () => {
      expect(
        messagesFor(createDirectSchema, { targetUserId: "not-a-uuid" }, "targetUserId"),
      ).toEqual(["VALIDATION_UUID_TARGET_USER"]);
    });

    it("rejects an empty string with the VALIDATION_UUID_TARGET_USER key", () => {
      expect(messagesFor(createDirectSchema, { targetUserId: "" }, "targetUserId")).toEqual([
        "VALIDATION_UUID_TARGET_USER",
      ]);
    });

    it("rejects missing targetUserId with VALIDATION_REQUIRED", () => {
      expect(messagesFor(createDirectSchema, {}, "targetUserId")).toEqual(["VALIDATION_REQUIRED"]);
    });
  });

  describe("markReadSchema", () => {
    it("accepts a valid UUID lastReadMessageId", () => {
      const result = markReadSchema.safeParse({
        lastReadMessageId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an invalid UUID with the VALIDATION_UUID_LAST_READ key", () => {
      expect(
        messagesFor(markReadSchema, { lastReadMessageId: "abc-123" }, "lastReadMessageId"),
      ).toEqual(["VALIDATION_UUID_LAST_READ"]);
    });

    it("rejects missing lastReadMessageId with VALIDATION_REQUIRED", () => {
      expect(messagesFor(markReadSchema, {}, "lastReadMessageId")).toEqual(["VALIDATION_REQUIRED"]);
    });
  });
});
