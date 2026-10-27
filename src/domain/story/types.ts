import type { StoryKind } from "./schema.js";

/** Immutable story snapshot embedded in a message. */
export interface StoryPreview {
  id: string;
  kind: StoryKind;
  bucket: string | null;
  objectKey: string | null;
  caption: string | null;
  background: string | null;
}
