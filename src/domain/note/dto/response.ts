import type { StoryUserSummary } from "../../story/dto/response.js";

export interface NoteResponse {
  id: string;
  userId: string;
  content: string;
  background: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface UserNoteFeedResponse {
  user: StoryUserSummary;
  note: NoteResponse;
}
