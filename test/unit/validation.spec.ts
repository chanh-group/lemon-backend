import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { upsertNoteSchema } from "../../src/domain/note/dto/request.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";

describe("standardSchemaPipe", () => {
  it("rejects a body that fails its schema and throws 422-type error", async () => {
    const metadata: ArgumentMetadata = { type: "body", schema: upsertNoteSchema };

    const pipe = standardSchemaPipe();
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toThrow(/^VALIDATION_ERROR: /);
  });

  it("returns the schema-transformed value", async () => {
    const trimmingSchema = z.object({
      content: z.string().transform((value) => value.trim()),
    });
    const metadata: ArgumentMetadata = { type: "body", schema: trimmingSchema };

    const result = await standardSchemaPipe().transform({ content: " hi " }, metadata);

    expect(result).toEqual({ content: "hi" });
  });
});
