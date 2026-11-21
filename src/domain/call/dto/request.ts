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
