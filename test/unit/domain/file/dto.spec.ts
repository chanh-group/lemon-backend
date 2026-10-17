import { describe, expect, it } from "vitest";
import { presignFileSchema } from "../../../../src/domain/file/dto/request.js";

describe("presignFileSchema", () => {
  const valid = { kind: "STORY_IMAGE", sizeBytes: 1024, mimeType: "image/jpeg" };

  it("accepts a valid payload", () => {
    expect(presignFileSchema.parse(valid)).toEqual(valid);
  });

  it("rejects unknown kinds", () => {
    expect(presignFileSchema.safeParse({ ...valid, kind: "AVATAR" }).success).toBe(false);
  });

  it("rejects non-positive or fractional sizes", () => {
    expect(presignFileSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(presignFileSchema.safeParse({ ...valid, sizeBytes: 1.5 }).success).toBe(false);
    expect(presignFileSchema.safeParse({ ...valid, sizeBytes: -1 }).success).toBe(false);
  });

  it("rejects empty or oversized mime types", () => {
    expect(presignFileSchema.safeParse({ ...valid, mimeType: "" }).success).toBe(false);
    expect(presignFileSchema.safeParse({ ...valid, mimeType: "x".repeat(256) }).success).toBe(
      false,
    );
  });
});
