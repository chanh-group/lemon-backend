import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";

export const createDirectSchema = z.object({
  targetUserId: z.string().uuid(vmsg("VALIDATION_UUID_TARGET_USER")),
});

export type CreateDirectDto = z.infer<typeof createDirectSchema>;

export const markReadSchema = z.object({
  lastReadMessageId: z.string().uuid(vmsg("VALIDATION_UUID_LAST_READ")),
});

export type MarkReadDto = z.infer<typeof markReadSchema>;
