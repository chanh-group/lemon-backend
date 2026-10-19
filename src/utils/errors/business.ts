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
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_SESSION: HttpStatus.UNAUTHORIZED,
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  INVALID_OTP: HttpStatus.BAD_REQUEST,
  INVALID_OLD_PASSWORD: HttpStatus.BAD_REQUEST,
  USER_ALREADY_EXISTS: HttpStatus.BAD_REQUEST,
  USERNAME_TAKEN: HttpStatus.BAD_REQUEST,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
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
  CONVERSATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  NOT_PARTICIPANT: HttpStatus.FORBIDDEN,
  MESSAGE_NOT_FOUND: HttpStatus.NOT_FOUND,
  MESSAGE_REVOKED: HttpStatus.BAD_REQUEST,
  CANNOT_CHAT_WITH_SELF: HttpStatus.BAD_REQUEST,
};

export interface ValidationIssue {
  path: string;
  message: string;
  params?: Record<string, string>;
}

export class BusinessError extends Error {
  constructor(
    readonly code: BusinessCode,
    readonly params?: Record<string, string>,
    readonly rawMessage?: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(code);
    this.name = "BusinessError";
  }

  static validation(issues: ValidationIssue[]): BusinessError {
    return new BusinessError("VALIDATION_ERROR", undefined, undefined, issues);
  }
}
