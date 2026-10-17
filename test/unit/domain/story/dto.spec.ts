import { describe, expect, it } from "vitest";
import { createStorySchema } from "../../../../src/domain/story/dto/request.js";

describe("createStorySchema", () => {
  it("accepts a valid IMAGE payload", () => {
    const result = createStorySchema.safeParse({
      kind: "IMAGE",
      objectKey: "stories/user-1/photo.jpg",
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
      caption: "A sunny day",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a caption longer than 500", () => {
    const result = createStorySchema.safeParse({
      kind: "TEXT",
      caption: "a".repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative width", () => {
    const result = createStorySchema.safeParse({
      kind: "IMAGE",
      objectKey: "stories/user-1/photo.jpg",
      width: -1,
    });

    expect(result.success).toBe(false);
  });

  it("strips unknown fields like bucket", () => {
    const result = createStorySchema.safeParse({
      kind: "TEXT",
      caption: "x",
      bucket: "evil",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected the payload to be accepted");
    }
    expect(result.data).not.toHaveProperty("bucket");
  });

  it("rejects a non-integer durationMs", () => {
    const result = createStorySchema.safeParse({
      kind: "VIDEO",
      objectKey: "stories/user-1/clip.mp4",
      durationMs: 10.5,
    });

    expect(result.success).toBe(false);
  });
});
