import { z } from "zod";
import { NOTE_MAX_CONTENT_LENGTH } from "../../../utils/cache/constants.js";

export const upsertNoteSchema = z.object({
  content: z.string().min(1).max(NOTE_MAX_CONTENT_LENGTH),
  background: z.string().max(200).optional().nullable(),
});

export type UpsertNoteDto = z.infer<typeof upsertNoteSchema>;
