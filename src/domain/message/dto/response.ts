import type { StoryPreview } from "../../story/dto/response.js";

export interface MessageResponse {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "SYSTEM";
  body: string | null;
  replyToId: string | null;
  storyId?: string | null;
  storyPreview?: StoryPreview | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface MessageTimelineResponse {
  items: MessageResponse[];
  nextCursor?: string;
  hasMore: boolean;
}
