import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import { MESSAGE_MAX_BODY_LENGTH } from "../../message/constants.js";
import {
  ALLOWED_STORY_EMOJIS,
  STORY_AUDIENCE_MODES,
  STORY_MAX_BACKGROUND_LENGTH,
  STORY_MAX_CAPTION_LENGTH,
  STORY_REACTION_KINDS,
} from "../constants.js";

export const createStorySchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO", "TEXT"]),
  objectKey: z.string().min(1).max(1024).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
  caption: z.string().max(STORY_MAX_CAPTION_LENGTH).optional(),
  background: z.string().max(STORY_MAX_BACKGROUND_LENGTH).optional(),
  allowReplies: z.boolean().optional(),
  allowReactions: z.boolean().optional(),
  audienceMode: z.enum(STORY_AUDIENCE_MODES).optional(),
  audienceUserIds: z.array(z.string().uuid()).max(500).optional(),
});

export type CreateStoryDto = z.infer<typeof createStorySchema>;

export const reactStorySchema = z.object({
  emoji: z.enum(ALLOWED_STORY_EMOJIS),
});

export type ReactStoryDto = z.infer<typeof reactStorySchema>;

export const replyStorySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"))
    .max(
      MESSAGE_MAX_BODY_LENGTH,
      vmsg("VALIDATION_BODY_MAX", { max: String(MESSAGE_MAX_BODY_LENGTH) }),
    ),
});

export type ReplyStoryDto = z.infer<typeof replyStorySchema>;

export const updateStorySettingsSchema = z.object({
  viewedReceiptsEnabled: z.boolean().optional(),
  archiveEnabled: z.boolean().optional(),
  archiveDurationSecs: z.number().int().min(0).nullable().optional(),
});

export type UpdateStorySettingsDto = z.infer<typeof updateStorySettingsSchema>;

export const getReactionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
  kind: z.enum(STORY_REACTION_KINDS).optional(),
});

export type GetReactionsQueryDto = z.infer<typeof getReactionsQuerySchema>;
