import type { Note } from "./schema.js";
import type { StoryUserSummary } from "../story/dto/response.js";

export const NOTE_REPOSITORY = Symbol("NOTE_REPOSITORY");

export interface NoteRepository {
  upsert(
    userId: string,
    data: { content: string; background?: string | null; expiresAt: Date },
  ): Promise<Note>;
  findActiveByUserId(userId: string): Promise<Note | null>;
  findActiveByUserIds(userIds: string[]): Promise<Note[]>;
  findUsersByIds(userIds: string[]): Promise<Map<string, StoryUserSummary>>;
  getFriendUserIds(userId: string): Promise<string[]>;
  deleteByUserId(userId: string): Promise<boolean>;
}
