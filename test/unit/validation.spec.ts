import { type ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { upsertNoteSchema } from "../../src/domain/note/dto/request.js";
import { BusinessError } from "../../src/utils/errors/business.js";
import { standardSchemaPipe } from "../../src/utils/validation.js";

describe("standardSchemaPipe", () => {
  it("rejects a body that fails its schema with a 422 validation business error", async () => {
    const metadata: ArgumentMetadata = { type: "body", schema: upsertNoteSchema };

    const pipe = standardSchemaPipe();
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toThrow(BusinessError);
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      rawMessage: expect.stringContaining("content"),
    });
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
