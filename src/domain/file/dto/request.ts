import { z } from "zod";

export const presignFileSchema = z.object({
  kind: z.enum(["STORY_IMAGE", "STORY_VIDEO"]),
  sizeBytes: z.number().int().min(1),
  mimeType: z.string().min(1).max(255),
});

export type PresignFileDto = z.infer<typeof presignFileSchema>;
