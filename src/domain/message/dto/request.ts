import { z } from "zod";

export const sendMessageSchema = z
  .object({
    body: z.string().max(4000, "Nội dung tin nhắn không được vượt quá 4000 ký tự").optional(),
    kind: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "SYSTEM"]).default("TEXT"),
    clientMsgId: z.string().uuid("clientMsgId phải là định dạng UUID").optional(),
    replyToId: z.string().uuid("replyToId phải là định dạng UUID").optional(),
  })
  .refine(
    (data) => {
      if (data.kind === "TEXT") {
        return typeof data.body === "string" && data.body.trim().length > 0;
      }
      return true;
    },
    { message: "Nội dung tin nhắn văn bản không được để trống", path: ["body"] },
  );

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z
    .string()
    .min(1, "Nội dung tin nhắn không được để trống")
    .max(4000, "Nội dung không vượt quá 4000 ký tự"),
});

export type EditMessageDto = z.infer<typeof editMessageSchema>;
