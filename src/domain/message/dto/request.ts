import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import { MESSAGE_MAX_BODY_LENGTH } from "../constants.js";

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
  })
  .refine(
    (data) => {
      if (data.kind === "TEXT") {
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
