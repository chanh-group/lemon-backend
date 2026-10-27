import { z } from "zod";

const fileKindSchema = z.enum([
  "STORY_IMAGE",
  "STORY_VIDEO",
  "CHAT_IMAGE",
  "CHAT_VIDEO",
  "CHAT_AUDIO",
  "CHAT_FILE",
]);

const fileUploadFieldsSchema = z.object({
  kind: fileKindSchema,
  conversationId: z.string().uuid().optional(),
});

const requireChatConversation = <T extends { kind: string; conversationId?: string }>(data: T) =>
  !data.kind.startsWith("CHAT_") || Boolean(data.conversationId);

export const fileUploadSchema = fileUploadFieldsSchema.refine(requireChatConversation);

export const presignFileSchema = fileUploadFieldsSchema
  .extend({
    sizeBytes: z.number().int().min(1),
    mimeType: z.string().min(1).max(255),
    fileName: z.string().min(1).max(255).optional(),
  })
  .refine(requireChatConversation);

export type PresignFileDto = z.infer<typeof presignFileSchema>;
