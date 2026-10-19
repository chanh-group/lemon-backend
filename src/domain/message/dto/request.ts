import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";

export const sendMessageSchema = z
  .object({
    body: z
      .string()
      .max(4000, vmsg("VALIDATION_BODY_MAX", { max: "4000" }))
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
    .max(4000, vmsg("VALIDATION_BODY_MAX", { max: "4000" })),
});

export type EditMessageDto = z.infer<typeof editMessageSchema>;
