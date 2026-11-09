import type { StoryPreview } from "../../story/types.js";
import type { MessageKind } from "../schema.js";

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

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string | null;
  replyToId: string | null;
  storyId?: string | null;
  storyPreview?: StoryPreview | null;
  attachments?: MessageAttachmentResponse[];
  reactions?: MessageReactionSummary[];
  isForwarded?: boolean;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface MessageTimelineResponse {
  items: MessageResponse[];
  nextCursor?: string;
  hasMore: boolean;
}
