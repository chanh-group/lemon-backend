import { z } from "zod";
import { FILE_MIME_TYPE_MAX_LENGTH, FILE_NAME_MAX_LENGTH } from "../constants.js";

const fileKindSchema = z.enum([
  "STORY_IMAGE",
  "STORY_VIDEO",
  "CHAT_IMAGE",
  "CHAT_VIDEO",
  "CHAT_AUDIO",
  "CHAT_FILE",
  "USER_AVATAR",
]);

const fileUploadFieldsSchema = z.object({
  kind: fileKindSchema,
  conversationId: z.string().uuid().optional(),
});

const requireChatConversation = <T extends { kind: string; conversationId?: string }>(data: T) =>
  !data.kind.startsWith("CHAT_") || Boolean(data.conversationId);

export const fileUploadSchema = fileUploadFieldsSchema.refine(
  (data) => data.kind !== "USER_AVATAR" && requireChatConversation(data),
);

export const presignFileSchema = fileUploadFieldsSchema
  .extend({
    sizeBytes: z.number().int().min(1),
    mimeType: z.string().min(1).max(FILE_MIME_TYPE_MAX_LENGTH),
    fileName: z.string().min(1).max(FILE_NAME_MAX_LENGTH).optional(),
  })
  .refine(requireChatConversation);

export type PresignFileDto = z.infer<typeof presignFileSchema>;
