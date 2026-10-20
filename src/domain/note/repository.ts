import type { Note } from "./schema.js";
import type { UserSummary } from "../user/dto/response.js";

export const NOTE_REPOSITORY = Symbol("NOTE_REPOSITORY");

export interface NoteRepository {
  upsert(
    userId: string,
    data: { content: string; background?: string | null; expiresAt: Date },
  ): Promise<Note>;
  findActiveByUserId(userId: string): Promise<Note | null>;
  findActiveFeedByUserIds(userIds: string[]): Promise<{ note: Note; user: UserSummary }[]>;
  getFriendUserIds(userId: string): Promise<string[]>;
  deleteByUserId(userId: string): Promise<boolean>;
  findExpiredIds(limit: number): Promise<string[]>;
  deleteByIds(ids: string[]): Promise<number>;
}
