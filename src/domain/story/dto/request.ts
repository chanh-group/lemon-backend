import { z } from "zod";
import { STORY_MAX_CAPTION_LENGTH } from "../../../utils/cache/constants.js";

export const createStorySchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO", "TEXT"]),
  objectKey: z.string().min(1).max(1024).optional(),
  mimeType: z.string().min(1).max(255).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  caption: z.string().max(STORY_MAX_CAPTION_LENGTH).optional(),
  background: z.string().max(200).optional(),
});

export type CreateStoryDto = z.infer<typeof createStorySchema>;
