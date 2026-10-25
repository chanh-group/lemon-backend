import type { StoryPreview } from "../../story/dto/response.js";

export interface MessageAttachmentResponse {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  previewUrl: string;
  downloadUrl: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "SYSTEM" | "STORY_REPLY" | "STORY_REACTION";
  body: string | null;
  replyToId: string | null;
  storyId?: string | null;
  storyPreview?: StoryPreview | null;
  attachments?: MessageAttachmentResponse[];
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface MessageTimelineResponse {
  items: MessageResponse[];
  nextCursor?: string;
  hasMore: boolean;
}
