import { describe, expect, it } from "vitest";
import { BusinessError, BUSINESS_STATUS } from "../../../../src/utils/errors/business.js";
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
  });

  it("validation() is a 422 VALIDATION_ERROR with raw details", () => {
    const err = BusinessError.validation("content: too_small");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.rawMessage).toBe("content: too_small");
    expect(errorStatus(err)).toBe(422);
  });
});
