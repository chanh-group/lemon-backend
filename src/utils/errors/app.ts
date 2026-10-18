import { HttpException, HttpStatus } from "@nestjs/common";
import type { BusinessCode, ErrorCode } from "./codes.js";
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

export function isAppError(error: unknown): error is AppError {
  return error instanceof BusinessError || error instanceof SystemError;
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
  const pgCode = (error as any)?.code || (error as any)?.cause?.code;
  if (pgCode === "22P02") {
    return new BusinessError(
      "BAD_REQUEST",
      undefined,
      "Định dạng ID không hợp lệ (yêu cầu định dạng UUID)",
    );
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
  return error instanceof BusinessError ? BUSINESS_STATUS[error.code] : SYSTEM_STATUS[error.kind];
}

export function errorCode(error: AppError): ErrorCode {
  return error instanceof BusinessError ? error.code : codeForStatus(errorStatus(error));
}
