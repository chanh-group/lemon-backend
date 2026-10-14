export interface StoryUserSummary {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface StoryItemResponse {
  id: string;
  userId: string;
  kind: "IMAGE" | "VIDEO" | "TEXT";
  bucket: string | null;
  objectKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  caption: string | null;
  background: string | null;
  createdAt: Date;
  expiresAt: Date;
  hasViewed?: boolean;
}

export interface UserStoryFeedResponse {
  user: StoryUserSummary;
  stories: StoryItemResponse[];
}

export interface StoryViewerResponse {
  user: StoryUserSummary;
  viewedAt: Date;
}
