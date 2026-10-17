export interface CreateStoryDto {
  kind: "IMAGE" | "VIDEO" | "TEXT";
  objectKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  caption?: string;
  background?: string;
}
