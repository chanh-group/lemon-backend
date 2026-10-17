import { BadRequestException, UnauthorizedException, type ArgumentsHost } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorFilter } from "../../../src/middleware/error-filter.js";
import { BusinessError } from "../../../src/utils/errors/business.js";
import { SystemError } from "../../../src/utils/errors/system.js";
import type { Logger } from "../../../src/utils/logger.js";

function createHost(acceptLanguage?: string) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("ErrorFilter", () => {
  let filter: ErrorFilter;
  let warnMock: ReturnType<typeof vi.fn>;
  let errorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warnMock = vi.fn();
    errorMock = vi.fn();
    filter = new ErrorFilter({
      log: vi.fn(),
      warn: warnMock,
      error: errorMock,
    } as unknown as Logger);
  });

  it("renders a business error with a localized message (vi default)", () => {
    const { host, status, json } = createHost();

    filter.catch(new BusinessError("STORY_NOT_FOUND"), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: "STORY_NOT_FOUND",
      message: "Story không tồn tại hoặc đã hết hạn",
    });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("honours Accept-Language for the message", () => {
    const { host, json } = createHost("en-US,en;q=0.9");

    filter.catch(new BusinessError("STORY_NOT_FOUND"), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Story does not exist or has expired" }),
    );
  });

  it("renders rawMessage verbatim (validation details are not localized)", () => {
    const { host, status, json } = createHost("en");

    filter.catch(BusinessError.validation("content: too_small"), host);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: "VALIDATION_ERROR",
      message: "content: too_small",
    });
  });

  it("interpolates params in the localized message", () => {
    const { host, json } = createHost();

    filter.catch(new BusinessError("FILE_TOO_LARGE", { maxMb: "10" }), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "File vượt quá giới hạn cho phép (10MB) — hãy chọn file nhỏ hơn 10MB",
      }),
    );
  });

  it("renders system errors as generic 503 without leaking the cause", () => {
    const { host, status, json } = createHost();

    filter.catch(
      new SystemError("cache", "cache GET failed", { cause: new Error("redis down") }),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    const payload = json.mock.calls[0][0] as { code: string; message: string };
    expect(payload.code).toBe("SERVICE_UNAVAILABLE");
    expect(payload.message).not.toContain("redis");
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("renders unknown throws as generic 500 without leaking details", () => {
    const { host, status, json } = createHost();

    filter.catch(new Error("secret db detail"), host);

    expect(status).toHaveBeenCalledWith(500);
    const payload = json.mock.calls[0][0] as { code: string; message: string };
    expect(payload.code).toBe("INTERNAL_SERVER_ERROR");
    expect(payload.message).not.toContain("secret db detail");
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it("maps Nest HttpExceptions through the taxonomy", () => {
    const unauthorized = createHost();
    filter.catch(new UnauthorizedException(), unauthorized.host);
    expect(unauthorized.status).toHaveBeenCalledWith(401);
    expect(unauthorized.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );

    const badRequest = createHost();
    filter.catch(new BadRequestException(), badRequest.host);
    expect(badRequest.status).toHaveBeenCalledWith(400);
    expect(badRequest.json).toHaveBeenCalledWith(expect.objectContaining({ code: "BAD_REQUEST" }));
  });
});
