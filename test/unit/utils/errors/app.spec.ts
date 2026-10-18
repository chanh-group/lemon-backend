import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  codeForStatus,
  errorCode,
  errorStatus,
  isAppError,
  toAppError,
} from "../../../../src/utils/errors/app.js";
import { BusinessError } from "../../../../src/utils/errors/business.js";
import { SystemError } from "../../../../src/utils/errors/system.js";

describe("toAppError", () => {
  it("passes AppErrors through unchanged", () => {
    const business = new BusinessError("STORY_NOT_FOUND");
    const system = new SystemError("internal", "boom");
    expect(toAppError(business)).toBe(business);
    expect(toAppError(system)).toBe(system);
    expect(isAppError(business)).toBe(true);
    expect(isAppError(system)).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("maps client HttpExceptions to business codes", () => {
    expect(errorCode(toAppError(new UnauthorizedException()))).toBe("UNAUTHORIZED");
    expect(errorStatus(toAppError(new UnauthorizedException()))).toBe(401);
    expect(errorCode(toAppError(new BadRequestException()))).toBe("BAD_REQUEST");
    expect(errorCode(toAppError(new NotFoundException()))).toBe("NOT_FOUND");
    expect(errorCode(toAppError(new HttpException("invalid", 422)))).toBe("VALIDATION_ERROR");
    expect(errorCode(toAppError(new HttpException("slow down", 429)))).toBe("TOO_MANY_REQUESTS");
  });

  it("maps HttpException 503 to a system unavailable error", () => {
    const err = toAppError(new HttpException("downstream down", 503));
    expect(err).toBeInstanceOf(SystemError);
    expect(errorCode(err)).toBe("SERVICE_UNAVAILABLE");
    expect(errorStatus(err)).toBe(503);
  });

  it("maps server HttpExceptions and unknown throws to generic 500", () => {
    expect(errorCode(toAppError(new InternalServerErrorException("db leak")))).toBe(
      "INTERNAL_SERVER_ERROR",
    );
    expect(errorStatus(toAppError(new InternalServerErrorException("db leak")))).toBe(500);
    expect(errorCode(toAppError(new Error("boom")))).toBe("INTERNAL_SERVER_ERROR");
    expect(errorCode(toAppError("string throw"))).toBe("INTERNAL_SERVER_ERROR");
    expect(errorCode(toAppError(undefined))).toBe("INTERNAL_SERVER_ERROR");
  });

  it("falls back unmapped client statuses to BAD_REQUEST", () => {
    expect(errorCode(toAppError(new HttpException("teapot", 418)))).toBe("BAD_REQUEST");
  });

  it("codeForStatus is the single status-to-code source", () => {
    expect(codeForStatus(404)).toBe("NOT_FOUND");
    expect(codeForStatus(503)).toBe("SERVICE_UNAVAILABLE");
    expect(codeForStatus(599)).toBe("INTERNAL_SERVER_ERROR");
  });
});
