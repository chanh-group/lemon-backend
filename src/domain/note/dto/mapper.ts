import type { Note } from "../schema.js";
import type { NoteResponse } from "./response.js";

export function toNoteResponse(note: Note): NoteResponse {
  return {
    id: note.id,
    userId: note.userId,
    content: note.content,
    background: note.background,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    expiresAt: note.expiresAt,
  };
}
