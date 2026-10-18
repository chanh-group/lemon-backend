import { HttpStatus } from "@nestjs/common";
import type { BusinessCode } from "./codes.js";

export const BUSINESS_STATUS: Record<BusinessCode, HttpStatus> = {
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  VALIDATION_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  STORY_NOT_FOUND: HttpStatus.NOT_FOUND,
  STORY_VIEW_FORBIDDEN: HttpStatus.FORBIDDEN,
  STORY_VIEWERS_FORBIDDEN: HttpStatus.FORBIDDEN,
  STORY_DELETE_FORBIDDEN: HttpStatus.FORBIDDEN,
  INVALID_MEDIA_TYPE: HttpStatus.BAD_REQUEST,
  INVALID_OBJECT_KEY: HttpStatus.BAD_REQUEST,
  TEXT_STORY_REQUIRES_CONTENT: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.BAD_REQUEST,
  FILE_TYPE_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  OBJECT_NOT_UPLOADED: HttpStatus.BAD_REQUEST,
  PRESIGN_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  NOTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  NOTE_EMPTY_CONTENT: HttpStatus.BAD_REQUEST,
};

export class BusinessError extends Error {
  constructor(
    readonly code: BusinessCode,
    readonly params?: Record<string, string>,
    readonly rawMessage?: string,
  ) {
    super(code);
    this.name = "BusinessError";
  }

  static validation(details: string): BusinessError {
    return new BusinessError("VALIDATION_ERROR", undefined, details);
  }
}
