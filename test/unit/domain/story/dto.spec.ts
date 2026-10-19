import { describe, expect, it } from "vitest";
import {
  createStorySchema,
  reactStorySchema,
  replyStorySchema,
} from "../../../../src/domain/story/dto/request.js";

describe("createStorySchema", () => {
  it("accepts a valid IMAGE payload", () => {
    const result = createStorySchema.safeParse({
      kind: "IMAGE",
      objectKey: "stories/user-1/photo.jpg",
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

  it("strips client-supplied mimeType (server derives it from HEAD)", () => {
    const result = createStorySchema.safeParse({
      kind: "IMAGE",
      objectKey: "stories/user-1/photo.jpg",
      mimeType: "image/jpeg",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected the payload to be accepted");
    }
    expect(result.data).not.toHaveProperty("mimeType");
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

describe("reactStorySchema", () => {
  it("accepts a valid emoji", () => {
    const result = reactStorySchema.safeParse({ emoji: "❤️" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.emoji).toBe("❤️");
  });

  it("trims whitespace from emoji", () => {
    const result = reactStorySchema.safeParse({ emoji: "  🔥  " });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.emoji).toBe("🔥");
  });

  it("rejects empty emoji string", () => {
    const result = reactStorySchema.safeParse({ emoji: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects emoji exceeding max length", () => {
    const result = reactStorySchema.safeParse({ emoji: "a".repeat(33) });
    expect(result.success).toBe(false);
  });
});

describe("replyStorySchema", () => {
  it("accepts valid reply body", () => {
    const result = replyStorySchema.safeParse({ body: "What a view! 🌟" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.body).toBe("What a view! 🌟");
  });

  it("rejects empty or whitespace-only reply body", () => {
    const result = replyStorySchema.safeParse({ body: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects body exceeding 4000 characters", () => {
    const result = replyStorySchema.safeParse({ body: "x".repeat(4001) });
    expect(result.success).toBe(false);
  });
});
