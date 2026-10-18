import { z } from "zod";

export const createDirectSchema = z.object({
  targetUserId: z.string().uuid("targetUserId phải là định dạng UUID hợp lệ"),
});

export type CreateDirectDto = z.infer<typeof createDirectSchema>;

export const markReadSchema = z.object({
  lastReadMessageId: z.string().uuid("lastReadMessageId phải là định dạng UUID hợp lệ"),
});

export type MarkReadDto = z.infer<typeof markReadSchema>;
