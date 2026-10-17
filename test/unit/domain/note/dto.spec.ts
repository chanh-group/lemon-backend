import { describe, expect, it } from "vitest";
import { upsertNoteSchema } from "../../../../src/domain/note/dto/request.js";

describe("upsertNoteSchema", () => {
  it("rejects empty content", () => {
    const result = upsertNoteSchema.safeParse({ content: "" });

    expect(result.success).toBe(false);
  });

  it("rejects content longer than 200", () => {
    const result = upsertNoteSchema.safeParse({ content: "a".repeat(201) });

    expect(result.success).toBe(false);
  });

  it("accepts nullable background", () => {
    const result = upsertNoteSchema.safeParse({ content: "Sunny day", background: null });

    expect(result.success).toBe(true);
  });
});
