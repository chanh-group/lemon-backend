import { describe, expect, it } from "vitest";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { mapUniqueViolation } from "../../../../src/utils/errors/pg.js";

describe("mapUniqueViolation", () => {
  it("maps a matching constraint to a conflict with field context", () => {
    const mapped = mapUniqueViolation(
      { code: "23505", constraint: "users_email_uq" },
      [
        ["email", "a@b.c"],
        ["username", "lemon"],
      ],
    );

    expect(mapped).toBeInstanceOf(BusinessError);
    expect(mapped).toMatchObject({
      code: "CONFLICT",
      rawMessage: "email already exists: a@b.c",
    });
  });

  it("returns non-unique and unknown unique errors unchanged", () => {
    const error = { code: "23503", constraint: "users_email_uq" };
    expect(mapUniqueViolation(error, [["email", "a@b.c"]])).toBe(error);

    const unknown = { code: "23505", constraint: "users_display_name_uq" };
    expect(mapUniqueViolation(unknown, [["email", "a@b.c"]])).toBe(unknown);
  });
});
