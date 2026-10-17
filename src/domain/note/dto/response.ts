import type { UserSummary } from "../../user/dto/response.js";

export interface NoteResponse {
  id: string;
  userId: string;
  content: string;
  background: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface UserNoteFeedResponse {
  user: UserSummary;
  note: NoteResponse;
}
