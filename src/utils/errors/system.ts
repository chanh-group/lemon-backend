import { HttpStatus } from "@nestjs/common";

export type SystemKind = "cache" | "storage" | "database" | "unavailable" | "internal";

export const SYSTEM_STATUS: Record<SystemKind, HttpStatus> = {
  cache: HttpStatus.SERVICE_UNAVAILABLE,
  storage: HttpStatus.SERVICE_UNAVAILABLE,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  database: HttpStatus.INTERNAL_SERVER_ERROR,
  internal: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class SystemError extends Error {
  constructor(
    readonly kind: SystemKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SystemError";
  }
}
