import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  editMessageSchema,
  sendMessageSchema,
} from "../../../../src/domain/message/dto/request.js";

function messagesFor(schema: z.ZodType, input: unknown, path?: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => (path === undefined ? true : issue.path.join(".") === path))
    .map((issue) => issue.message);
}

describe("Message DTOs", () => {
  describe("sendMessageSchema", () => {
    it("accepts a valid TEXT message", () => {
      const result = sendMessageSchema.safeParse({
        body: "Xin chào bạn!",
        kind: "TEXT",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("TEXT");
        expect(result.data.body).toBe("Xin chào bạn!");
      }
    });

    it("defaults kind to TEXT when omitted", () => {
      const result = sendMessageSchema.safeParse({
        body: "Tin nhắn mặc định",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("TEXT");
      }
    });

    it("accepts valid clientMsgId and replyToId as UUID", () => {
      const result = sendMessageSchema.safeParse({
        body: "Có reply và clientMsgId",
        clientMsgId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        replyToId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6c",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-UUID clientMsgId with the VALIDATION_UUID_CLIENT_MSG key", () => {
      expect(
        messagesFor(sendMessageSchema, { body: "Hello", clientMsgId: "not-a-uuid" }, "clientMsgId"),
      ).toEqual(["VALIDATION_UUID_CLIENT_MSG"]);
    });

    it("rejects non-UUID replyToId with the VALIDATION_UUID_REPLY_TO key", () => {
      expect(
        messagesFor(sendMessageSchema, { body: "Hello", replyToId: "not-a-uuid" }, "replyToId"),
      ).toEqual(["VALIDATION_UUID_REPLY_TO"]);
    });

    it("rejects TEXT message with empty body with VALIDATION_MESSAGE_BODY_REQUIRED", () => {
      expect(messagesFor(sendMessageSchema, { body: "", kind: "TEXT" }, "body")).toEqual([
        "VALIDATION_MESSAGE_BODY_REQUIRED",
      ]);
    });

    it("rejects TEXT message with whitespace-only body with VALIDATION_MESSAGE_BODY_REQUIRED", () => {
      expect(messagesFor(sendMessageSchema, { body: "     ", kind: "TEXT" }, "body")).toEqual([
        "VALIDATION_MESSAGE_BODY_REQUIRED",
      ]);
    });

    it("rejects TEXT message with missing body with VALIDATION_MESSAGE_BODY_REQUIRED", () => {
      expect(messagesFor(sendMessageSchema, { kind: "TEXT" }, "body")).toEqual([
        "VALIDATION_MESSAGE_BODY_REQUIRED",
      ]);
    });

    it("rejects body longer than 4000 characters with the encoded VALIDATION_BODY_MAX key", () => {
      expect(
        messagesFor(sendMessageSchema, { body: "a".repeat(4001), kind: "TEXT" }, "body"),
      ).toEqual(["VALIDATION_BODY_MAX|max=4000"]);
    });

    it("accepts IMAGE or FILE kind without body", () => {
      const result = sendMessageSchema.safeParse({
        kind: "IMAGE",
      });
      expect(result.success).toBe(true);
    });

    it("strips client-supplied storyId and storyPreview from the parsed payload", () => {
      const result = sendMessageSchema.safeParse({
        body: "Spoofed story quote",
        storyId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        storyPreview: {
          id: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
          kind: "IMAGE",
          bucket: "lemon-stories",
          objectKey: "stories/attacker/secret.jpg",
          caption: "spoofed",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("storyId");
        expect(result.data).not.toHaveProperty("storyPreview");
      }
    });

    it("rejects invalid kind enum value", () => {
      const result = sendMessageSchema.safeParse({
        body: "Hello",
        kind: "UNKNOWN_KIND" as any,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("editMessageSchema", () => {
    it("accepts valid non-empty body", () => {
      const result = editMessageSchema.safeParse({
        body: "Nội dung cập nhật",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty body with VALIDATION_MESSAGE_BODY_REQUIRED", () => {
      expect(messagesFor(editMessageSchema, { body: "" }, "body")).toEqual([
        "VALIDATION_MESSAGE_BODY_REQUIRED",
      ]);
    });

    it("rejects body longer than 4000 characters with the encoded VALIDATION_BODY_MAX key", () => {
      expect(messagesFor(editMessageSchema, { body: "x".repeat(4001) }, "body")).toEqual([
        "VALIDATION_BODY_MAX|max=4000",
      ]);
    });
  });
});
