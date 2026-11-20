import { describe, expect, it } from "vitest";
import {
  endCallSchema,
  initiateCallSchema,
  mediaStateSchema,
  rejectCallSchema,
  signalAnswerSchema,
  signalIceCandidateSchema,
  signalOfferSchema,
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
    it("accepts optional reason", () => {
      expect(rejectCallSchema.safeParse({}).success).toBe(true);
      expect(rejectCallSchema.safeParse({ reason: "Busy right now" }).success).toBe(true);
      expect(endCallSchema.safeParse({}).success).toBe(true);
      expect(endCallSchema.safeParse({ reason: "Call finished" }).success).toBe(true);
    });
  });

  describe("signalling schemas", () => {
    it("validates offer, answer, ice-candidate, and media-state", () => {
      expect(
        signalOfferSchema.safeParse({
          callId: validUuid,
          sdp: { type: "offer", sdp: "v=0..." },
        }).success,
      ).toBe(true);

      expect(
        signalAnswerSchema.safeParse({
          callId: validUuid,
          sdp: { type: "answer", sdp: "v=0..." },
        }).success,
      ).toBe(true);

      expect(
        signalIceCandidateSchema.safeParse({
          callId: validUuid,
          candidate: { candidate: "candidate:...", sdpMid: "0" },
        }).success,
      ).toBe(true);

      expect(
        mediaStateSchema.safeParse({
          callId: validUuid,
          isMuted: true,
          isVideoOff: false,
        }).success,
      ).toBe(true);
    });
  });
});
