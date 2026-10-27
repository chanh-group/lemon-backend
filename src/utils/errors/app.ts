import { HttpException, HttpStatus } from "@nestjs/common";
import { ERROR_CODES, type BusinessCode, type ErrorCode } from "./codes.js";
import { BUSINESS_STATUS, BusinessError } from "./business.js";
import { SYSTEM_STATUS, SystemError } from "./system.js";

export type AppError = BusinessError | SystemError;

export interface ErrorResponse {
  success: false;
  code: ErrorCode;
  message: string;
}

const BUSINESS_CODE_BY_STATUS: Partial<Record<number, BusinessCode>> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "VALIDATION_ERROR",
  [HttpStatus.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
};

const ERROR_STATUS_BY_CODE: Record<ErrorCode, number> = {
  ...BUSINESS_STATUS,
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: SYSTEM_STATUS.internal,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: SYSTEM_STATUS.unavailable,
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof BusinessError || error instanceof SystemError;
}

function hasErrorCode(error: unknown): error is { code: unknown } {
  return typeof error === "object" && error !== null && "code" in error;
}

export function businessCodeForStatus(status: number): BusinessCode {
  return BUSINESS_CODE_BY_STATUS[status] ?? "BAD_REQUEST";
}

export function codeForStatus(status: number): ErrorCode {
  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return "SERVICE_UNAVAILABLE";
  }
  return BUSINESS_CODE_BY_STATUS[status] ?? "INTERNAL_SERVER_ERROR";
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (hasErrorCode(error) && error.code === "LIMIT_FILE_SIZE") {
    return new BusinessError("FILE_TOO_LARGE");
  }
  const cause =
    typeof error === "object" && error !== null && "cause" in error ? error.cause : undefined;
  const pgCode =
    (hasErrorCode(error) ? error.code : undefined) ??
    (hasErrorCode(cause) ? cause.code : undefined);
  if (pgCode === "22P02") {
    return new BusinessError("BAD_REQUEST");
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      return new SystemError("unavailable", error.message, { cause: error });
    }
    if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
      return new BusinessError(businessCodeForStatus(status));
    }
    return new SystemError("internal", error.message, { cause: error });
  }
  return new SystemError("internal", "Unexpected error", { cause: error });
}

export function errorStatus(error: AppError): number {
  const exact =
    error instanceof BusinessError ? BUSINESS_STATUS[error.code] : SYSTEM_STATUS[error.kind];
  if (exact !== undefined) {
    return exact;
  }

  for (const [code, status] of Object.entries(ERROR_STATUS_BY_CODE)) {
    if (code === error.message) {
      return status;
    }
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

export function errorCode(error: AppError): ErrorCode {
  return error instanceof BusinessError ? error.code : codeForStatus(errorStatus(error));
}
