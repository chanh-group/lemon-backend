import { describe, expect, it } from "vitest";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { isUniqueViolation, mapUniqueViolation } from "../../../../src/utils/errors/pg.js";

describe("mapUniqueViolation", () => {
  it("maps a matching constraint to a conflict with field context", () => {
    const mapped = mapUniqueViolation({ code: "23505", constraint: "users_email_uq" }, [
      ["email", "a@b.c"],
      ["username", "lemon"],
    ]);

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

describe("isUniqueViolation", () => {
  it("is true for a 23505 error whose constraint includes the pattern", () => {
    expect(
      isUniqueViolation(
        { code: "23505", constraint: "messages_client_msg_uq" },
        "messages_client_msg_uq",
      ),
    ).toBe(true);
  });

  it("is false when the error code is not 23505", () => {
    expect(
      isUniqueViolation(
        { code: "23503", constraint: "messages_client_msg_uq" },
        "messages_client_msg_uq",
      ),
    ).toBe(false);
  });

  it("is false when the constraint does not include the pattern", () => {
    expect(
      isUniqueViolation({ code: "23505", constraint: "users_email_uq" }, "messages_client_msg_uq"),
    ).toBe(false);
  });

  it("is false for null, plain errors and a missing or non-string constraint", () => {
    expect(isUniqueViolation(null, "messages_client_msg_uq")).toBe(false);
    expect(isUniqueViolation(new Error("connection reset"), "messages_client_msg_uq")).toBe(false);
    expect(isUniqueViolation({ code: "23505" }, "messages_client_msg_uq")).toBe(false);
    expect(isUniqueViolation({ code: "23505", constraint: 42 }, "messages_client_msg_uq")).toBe(
      false,
    );
  });
});
