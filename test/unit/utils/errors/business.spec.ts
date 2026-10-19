import { describe, expect, it } from "vitest";
import {
  BusinessError,
  BUSINESS_STATUS,
  type ValidationIssue,
} from "../../../../src/utils/errors/business.js";
import { ERROR_CODES } from "../../../../src/utils/errors/codes.js";
import { errorStatus } from "../../../../src/utils/errors/app.js";

describe("BusinessError", () => {
  it("maps every business code to an HTTP status", () => {
    const systemCodes = ["INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"];
    const businessCodes = Object.values(ERROR_CODES).filter((code) => !systemCodes.includes(code));

    for (const code of businessCodes) {
      expect((BUSINESS_STATUS as Record<string, number>)[code]).toBeTypeOf("number");
    }
  });

  it("maps auth codes to the exact Rust-aligned statuses", () => {
    const expected: Array<[BusinessError["code"], number]> = [
      ["INVALID_CREDENTIALS", 401],
      ["INVALID_SESSION", 401],
      ["EMAIL_NOT_VERIFIED", 403],
      ["INVALID_OTP", 400],
      ["INVALID_OLD_PASSWORD", 400],
      ["USER_ALREADY_EXISTS", 400],
      ["USERNAME_TAKEN", 400],
      ["USER_NOT_FOUND", 404],
      ["UNAUTHORIZED", 401],
      ["FORBIDDEN", 403],
      ["TOO_MANY_REQUESTS", 429],
    ];

    for (const [code, status] of expected) {
      expect(errorStatus(new BusinessError(code))).toBe(status);
    }
  });

  it("only uses client statuses or 503 for business codes", () => {
    for (const status of Object.values(BUSINESS_STATUS)) {
      expect([400, 401, 403, 404, 409, 422, 429, 503]).toContain(status);
    }
  });

  it("carries code, optional params and optional rawMessage", () => {
    const err = new BusinessError("FILE_TOO_LARGE", { maxMb: "10" });
    expect(err.code).toBe("FILE_TOO_LARGE");
    expect(err.params).toEqual({ maxMb: "10" });
    expect(err.rawMessage).toBeUndefined();
    expect(err.issues).toBeUndefined();
  });

  it("carries structured issues as the fourth constructor argument", () => {
    const issues: ValidationIssue[] = [{ path: "email", message: "VALIDATION_EMAIL" }];
    const err = new BusinessError("VALIDATION_ERROR", undefined, undefined, issues);
    expect(err.issues).toEqual(issues);
  });

  it("validation() is a 422 VALIDATION_ERROR carrying structured issues", () => {
    const issues: ValidationIssue[] = [
      { path: "content", message: "VALIDATION_MIN", params: { min: "1" } },
    ];
    const err = BusinessError.validation(issues);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.issues).toEqual(issues);
    expect(errorStatus(err)).toBe(422);
  });
});
