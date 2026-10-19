import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import { STORY_MAX_BACKGROUND_LENGTH, STORY_MAX_CAPTION_LENGTH } from "../constants.js";

export const createStorySchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO", "TEXT"]),
  objectKey: z.string().min(1).max(1024).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  caption: z.string().max(STORY_MAX_CAPTION_LENGTH).optional(),
  background: z.string().max(STORY_MAX_BACKGROUND_LENGTH).optional(),
});

export type CreateStoryDto = z.infer<typeof createStorySchema>;

export const ALLOWED_STORY_EMOJIS = ["❤️", "🔥", "😂", "😮", "😢", "👏", "👍"] as const;

export const reactStorySchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1, vmsg("VALIDATION_REQUIRED"))
    .max(32, vmsg("VALIDATION_MAX", { max: "32" })),
});

export type ReactStoryDto = z.infer<typeof reactStorySchema>;

export const replyStorySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"))
    .max(4000, vmsg("VALIDATION_BODY_MAX", { max: "4000" })),
});

export type ReplyStoryDto = z.infer<typeof replyStorySchema>;
