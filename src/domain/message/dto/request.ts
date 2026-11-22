import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import {
  ALLOWED_MESSAGE_REACTIONS,
  MESSAGE_FILE_NAME_MAX_LENGTH,
  MESSAGE_MAX_ATTACHMENTS,
  MESSAGE_MAX_BODY_LENGTH,
  MESSAGE_MIME_TYPE_MAX_LENGTH,
  MESSAGE_OBJECT_KEY_MAX_LENGTH,
} from "../constants.js";
import { isMessageBodyWithinLimit } from "../body-length.js";

export const messageAttachmentInputSchema = z.object({
  objectKey: z.string().min(1).max(MESSAGE_OBJECT_KEY_MAX_LENGTH),
  fileName: z.string().min(1).max(MESSAGE_FILE_NAME_MAX_LENGTH),
  mimeType: z.string().min(1).max(MESSAGE_MIME_TYPE_MAX_LENGTH),
  sizeBytes: z.number().int().min(1),
  kind: z.enum(["IMAGE", "VIDEO", "AUDIO", "FILE"]).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  checksum: z.string().optional(),
});

export type MessageAttachmentInputDto = z.infer<typeof messageAttachmentInputSchema>;

export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .optional()
      .refine((value) => value === undefined || isMessageBodyWithinLimit(value), {
        message: vmsg("VALIDATION_BODY_MAX", { max: String(MESSAGE_MAX_BODY_LENGTH) }),
      }),
    kind: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE"]).default("TEXT"),
    clientMsgId: z.string().uuid(vmsg("VALIDATION_UUID_CLIENT_MSG")),
    replyToId: z.string().uuid(vmsg("VALIDATION_UUID_REPLY_TO")).nullish(),
    attachments: z.array(messageAttachmentInputSchema).max(MESSAGE_MAX_ATTACHMENTS).optional(),
    isForwarded: z.boolean().optional(),
    sourceMessageId: z.string().uuid().optional(),
  })
  .refine(
    (data) =>
      (!data.sourceMessageId || data.isForwarded === true) &&
      (data.isForwarded !== true || Boolean(data.sourceMessageId)),
    { message: vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"), path: ["isForwarded"] },
  )
  .refine(
    (data) => {
      if (data.isForwarded && data.sourceMessageId) return true;
      const hasAttachments = Boolean(data.attachments && data.attachments.length > 0);
      if (data.kind === "TEXT" && !hasAttachments) {
        return typeof data.body === "string" && data.body.trim().length > 0;
      }
      return data.kind === "TEXT" || (hasAttachments && !data.body?.trim());
    },
    { message: vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"), path: ["body"] },
  );

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z
    .string()
    .min(1, vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"))
    .refine(isMessageBodyWithinLimit, {
      message: vmsg("VALIDATION_BODY_MAX", { max: String(MESSAGE_MAX_BODY_LENGTH) }),
    }),
});

export type EditMessageDto = z.infer<typeof editMessageSchema>;

export const reactMessageSchema = z.object({
  emoji: z.enum(ALLOWED_MESSAGE_REACTIONS),
});

export type ReactMessageDto = z.infer<typeof reactMessageSchema>;
