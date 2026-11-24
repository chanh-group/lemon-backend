import { describe, expect, it } from "vitest";
import {
  endCallSchema,
  initiateCallSchema,
  rejectCallSchema,
} from "../../../../src/domain/call/dto/request.js";

describe("Call DTOs", () => {
  const validUuid = "0193a2b1-0000-7000-8000-000000000001";

  describe("initiateCallSchema", () => {
    it("accepts valid input with VOICE or VIDEO", () => {
      const voice = initiateCallSchema.safeParse({
        conversationId: validUuid,
        media: "VOICE",
      });
      expect(voice.success).toBe(true);

      const video = initiateCallSchema.safeParse({
        conversationId: validUuid,
        media: "VIDEO",
      });
      expect(video.success).toBe(true);
    });

    it("rejects invalid uuid or media", () => {
      const badUuid = initiateCallSchema.safeParse({
        conversationId: "not-a-uuid",
        media: "VOICE",
      });
      expect(badUuid.success).toBe(false);

      const badMedia = initiateCallSchema.safeParse({
        conversationId: validUuid,
        media: "AUDIO",
      });
      expect(badMedia.success).toBe(false);
    });
  });

  describe("rejectCallSchema and endCallSchema", () => {
    it("accepts an optional valid reason", () => {
      expect(rejectCallSchema.safeParse({}).success).toBe(true);
      expect(rejectCallSchema.safeParse({ reason: "BUSY" }).success).toBe(true);
      expect(endCallSchema.safeParse({}).success).toBe(true);
      expect(endCallSchema.safeParse({ reason: "USER_HANGUP" }).success).toBe(true);
    });

    it("rejects unsupported reasons", () => {
      expect(rejectCallSchema.safeParse({ reason: "Busy right now" }).success).toBe(false);
      expect(endCallSchema.safeParse({ reason: "Call finished" }).success).toBe(false);
    });
  });
});
