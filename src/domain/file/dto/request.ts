import { z } from "zod";

export const presignFileSchema = z.object({
  kind: z.enum([
    "STORY_IMAGE",
    "STORY_VIDEO",
    "CHAT_IMAGE",
    "CHAT_VIDEO",
    "CHAT_AUDIO",
    "CHAT_FILE",
  ]),
  sizeBytes: z.number().int().min(1),
  mimeType: z.string().min(1).max(255),
  fileName: z.string().min(1).max(255).optional(),
  conversationId: z.string().uuid().optional(),
});

export type PresignFileDto = z.infer<typeof presignFileSchema>;
