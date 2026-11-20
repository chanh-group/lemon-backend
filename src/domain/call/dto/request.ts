import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";

export const initiateCallSchema = z.object({
  conversationId: z.string().uuid(vmsg("VALIDATION_FORMAT")),
  media: z.enum(["VOICE", "VIDEO"]),
});
export type InitiateCallDto = z.infer<typeof initiateCallSchema>;

export const rejectCallSchema = z.object({
  reason: z.string().trim().max(100).optional(),
});
export type RejectCallDto = z.infer<typeof rejectCallSchema>;

export const endCallSchema = z.object({
  reason: z.string().trim().max(100).optional(),
});
export type EndCallDto = z.infer<typeof endCallSchema>;

export const signalOfferSchema = z.object({
  callId: z.string().uuid(vmsg("VALIDATION_FORMAT")),
  sdp: z.unknown(),
});
export type SignalOfferDto = z.infer<typeof signalOfferSchema>;

export const signalAnswerSchema = z.object({
  callId: z.string().uuid(vmsg("VALIDATION_FORMAT")),
  sdp: z.unknown(),
});
export type SignalAnswerDto = z.infer<typeof signalAnswerSchema>;

export const signalIceCandidateSchema = z.object({
  callId: z.string().uuid(vmsg("VALIDATION_FORMAT")),
  candidate: z.unknown(),
});
export type SignalIceCandidateDto = z.infer<typeof signalIceCandidateSchema>;

export const mediaStateSchema = z.object({
  callId: z.string().uuid(vmsg("VALIDATION_FORMAT")),
  isMuted: z.boolean().optional(),
  isVideoOff: z.boolean().optional(),
});
export type MediaStateDto = z.infer<typeof mediaStateSchema>;
