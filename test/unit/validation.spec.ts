import { type ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { upsertNoteSchema } from "../../src/domain/note/dto/request.js";
import { BusinessError } from "../../src/utils/errors/business.js";
import {
  decodeValidationMessage,
  isEncodedKey,
  parseSchemaIssues,
  standardSchemaPipe,
  vmsg,
} from "../../src/utils/validation.js";

async function messagesFor(schema: z.ZodType, value: unknown): Promise<string[]> {
  const result = await schema["~standard"].validate(value);
  return result.issues?.map((issue) => issue.message) ?? [];
}

describe("zod customError via standard-schema validate (PROBE)", () => {
  it("applies customError through ~standard.validate and lets schema messages win", async () => {
    const schema = z.object({
      a: z.string().min(3, vmsg("VALIDATION_MIN", { min: "3" })),
      b: z.string().min(2),
    });

    const result = await schema["~standard"].validate({ a: "x", b: "y" });

    expect(result.issues?.map((issue) => issue.message)).toEqual([
      "VALIDATION_MIN|min=3",
      "VALIDATION_MIN|min=2",
    ]);
  });
});

describe("customError key mapping", () => {
  it("maps a missing value to VALIDATION_REQUIRED", async () => {
    expect(await messagesFor(z.object({ name: z.string() }), {})).toEqual(["VALIDATION_REQUIRED"]);
  });

  it("maps a wrong type to VALIDATION_TYPE with the expected param", async () => {
    expect(await messagesFor(z.string(), 42)).toEqual(["VALIDATION_TYPE|expected=string"]);
  });

  it("maps too_small to VALIDATION_MIN with the min param", async () => {
    expect(await messagesFor(z.string().min(5), "ab")).toEqual(["VALIDATION_MIN|min=5"]);
  });

  it("maps too_big to VALIDATION_MAX with the max param", async () => {
    expect(await messagesFor(z.string().max(3), "abcd")).toEqual(["VALIDATION_MAX|max=3"]);
  });

  it("maps the email format to VALIDATION_EMAIL", async () => {
    expect(await messagesFor(z.string().email(), "nope")).toEqual(["VALIDATION_EMAIL"]);
  });

  it("maps other string formats to VALIDATION_FORMAT", async () => {
    expect(await messagesFor(z.string().regex(/^[a-z]+$/), "ABC")).toEqual(["VALIDATION_FORMAT"]);
  });

  it("maps invalid enum values to VALIDATION_ENUM", async () => {
    expect(await messagesFor(z.enum(["a", "b"]), "c")).toEqual(["VALIDATION_ENUM"]);
  });

  it("maps unmapped issue codes to VALIDATION_INVALID", async () => {
    expect(
      await messagesFor(
        z.string().refine(() => false),
        "x",
      ),
    ).toEqual(["VALIDATION_INVALID"]);
  });

  it("keeps an explicit schema message over customError", async () => {
    expect(await messagesFor(z.string().min(3, vmsg("VALIDATION_MIN", { min: "3" })), "x")).toEqual(
      ["VALIDATION_MIN|min=3"],
    );
  });
});

describe("vmsg", () => {
  it("encodes a bare key without params", () => {
    expect(vmsg("VALIDATION_EMAIL")).toBe("VALIDATION_EMAIL");
  });

  it("encodes params as k=v pairs joined by &", () => {
    expect(vmsg("VALIDATION_MIN", { min: "3" })).toBe("VALIDATION_MIN|min=3");
    expect(vmsg("VALIDATION_MAX", { max: "10", unit: "chars" })).toBe(
      "VALIDATION_MAX|max=10&unit=chars",
    );
  });

  it("percent-encodes param values", () => {
    expect(vmsg("VALIDATION_MIN", { min: "a b&c|d=e" })).toBe(
      "VALIDATION_MIN|min=a%20b%26c%7Cd%3De",
    );
  });
});

describe("decodeValidationMessage", () => {
  it("passes plain text through verbatim", () => {
    expect(decodeValidationMessage("raw detail")).toEqual({ message: "raw detail" });
  });

  it("passes non-key text with separators through verbatim", () => {
    expect(decodeValidationMessage("content: too_small")).toEqual({
      message: "content: too_small",
    });
  });

  it("decodes a bare key", () => {
    expect(decodeValidationMessage("VALIDATION_EMAIL")).toEqual({ message: "VALIDATION_EMAIL" });
  });

  it("decodes a key with params", () => {
    expect(decodeValidationMessage("VALIDATION_MIN|min=3")).toEqual({
      message: "VALIDATION_MIN",
      params: { min: "3" },
    });
  });

  it("round-trips values encoded by vmsg", () => {
    expect(decodeValidationMessage(vmsg("VALIDATION_MIN", { min: "a b&c" }))).toEqual({
      message: "VALIDATION_MIN",
      params: { min: "a b&c" },
    });
  });
});

describe("isEncodedKey", () => {
  it("accepts catalogue-shaped keys with or without params", () => {
    expect(isEncodedKey("VALIDATION_EMAIL")).toBe(true);
    expect(isEncodedKey("VALIDATION_MIN|min=3")).toBe(true);
    expect(isEncodedKey("A2_B|k=v")).toBe(true);
  });

  it("rejects plain text and text that only looks partly like a key", () => {
    expect(isEncodedKey("raw detail")).toBe(false);
    expect(isEncodedKey("content: too_small")).toBe(false);
    expect(isEncodedKey("lowercase_key")).toBe(false);
    expect(isEncodedKey("")).toBe(false);
  });
});

describe("parseSchemaIssues", () => {
  it("formats primitive and object path segments with dots", () => {
    const issues = parseSchemaIssues([
      { path: ["user", { key: "email" }], message: "VALIDATION_EMAIL" },
    ]);

    expect(issues).toEqual([{ path: "user.email", message: "VALIDATION_EMAIL" }]);
  });

  it("decodes encoded messages into key + params", () => {
    const issues = parseSchemaIssues([{ path: ["age"], message: "VALIDATION_MIN|min=18" }]);

    expect(issues).toEqual([{ path: "age", message: "VALIDATION_MIN", params: { min: "18" } }]);
  });

  it("keeps plain-text messages verbatim", () => {
    expect(parseSchemaIssues([{ path: ["content"], message: "raw detail" }])).toEqual([
      { path: "content", message: "raw detail" },
    ]);
  });

  it("keeps a missing path as an empty string", () => {
    expect(parseSchemaIssues([{ message: "VALIDATION_INVALID" }])).toEqual([
      { path: "", message: "VALIDATION_INVALID" },
    ]);
  });

  it("preserves issue order", () => {
    const issues = parseSchemaIssues([
      { path: ["a"], message: "VALIDATION_REQUIRED" },
      { path: ["b"], message: "VALIDATION_EMAIL" },
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(["a", "b"]);
  });
});

describe("standardSchemaPipe", () => {
  it("rejects a body that fails its schema with structured validation issues", async () => {
    const metadata: ArgumentMetadata = { type: "body", schema: upsertNoteSchema };

    const pipe = standardSchemaPipe();
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toThrow(BusinessError);
    await expect(pipe.transform({ content: "" }, metadata)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ path: "content", message: "VALIDATION_MIN", params: { min: "1" } }],
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
