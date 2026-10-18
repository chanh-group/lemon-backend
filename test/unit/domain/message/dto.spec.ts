import { describe, expect, it } from "vitest";
import {
  editMessageSchema,
  sendMessageSchema,
} from "../../../../src/domain/message/dto/request.js";

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

    it("rejects non-UUID clientMsgId", () => {
      const result = sendMessageSchema.safeParse({
        body: "Hello",
        clientMsgId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects TEXT message with empty body", () => {
      const result = sendMessageSchema.safeParse({
        body: "",
        kind: "TEXT",
      });
      expect(result.success).toBe(false);
    });

    it("rejects TEXT message with whitespace-only body", () => {
      const result = sendMessageSchema.safeParse({
        body: "     ",
        kind: "TEXT",
      });
      expect(result.success).toBe(false);
    });

    it("rejects body longer than 4000 characters", () => {
      const result = sendMessageSchema.safeParse({
        body: "a".repeat(4001),
        kind: "TEXT",
      });
      expect(result.success).toBe(false);
    });

    it("accepts IMAGE or FILE kind without body", () => {
      const result = sendMessageSchema.safeParse({
        kind: "IMAGE",
      });
      expect(result.success).toBe(true);
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

    it("rejects empty body", () => {
      const result = editMessageSchema.safeParse({
        body: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects body longer than 4000 characters", () => {
      const result = editMessageSchema.safeParse({
        body: "x".repeat(4001),
      });
      expect(result.success).toBe(false);
    });
  });
});
