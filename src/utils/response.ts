// Standard API Response Envelope helper — conforms to docs/RESPONSES.md

export interface SuccessResponse<T = unknown> {
  success: true;
  message: string;
  data?: T;
}

export interface ErrorResponse {
  success: false;
  code: string;
  message: string;
}

export function ok<T>(data: T, message = "OK"): SuccessResponse<T> {
  return {
    success: true,
    message,
    data,
  };
}

export function created<T>(data: T, message = "OK"): SuccessResponse<T> {
  return {
    success: true,
    message,
    data,
  };
}

export function messageOnly(message: string): SuccessResponse<never> {
  return {
    success: true,
    message,
  };
}

export class AppHttpException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppHttpException";
  }
}

