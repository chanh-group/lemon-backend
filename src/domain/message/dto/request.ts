import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import { MESSAGE_MAX_BODY_LENGTH } from "../constants.js";

export const messageAttachmentInputSchema = z.object({
  objectKey: z.string().min(1).max(512),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
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
      .max(
        MESSAGE_MAX_BODY_LENGTH,
        vmsg("VALIDATION_BODY_MAX", { max: String(MESSAGE_MAX_BODY_LENGTH) }),
      )
      .optional(),
    kind: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "SYSTEM"]).default("TEXT"),
    clientMsgId: z.string().uuid(vmsg("VALIDATION_UUID_CLIENT_MSG")).optional(),
    replyToId: z.string().uuid(vmsg("VALIDATION_UUID_REPLY_TO")).optional(),
    attachments: z.array(messageAttachmentInputSchema).max(10).optional(),
  })
  .refine(
    (data) => {
      const hasAttachments = Boolean(data.attachments && data.attachments.length > 0);
      if (data.kind === "TEXT" && !hasAttachments) {
        return typeof data.body === "string" && data.body.trim().length > 0;
      }
      return true;
    },
    { message: vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"), path: ["body"] },
  );

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z
    .string()
    .min(1, vmsg("VALIDATION_MESSAGE_BODY_REQUIRED"))
    .max(
      MESSAGE_MAX_BODY_LENGTH,
      vmsg("VALIDATION_BODY_MAX", { max: String(MESSAGE_MAX_BODY_LENGTH) }),
    ),
});

export type EditMessageDto = z.infer<typeof editMessageSchema>;
