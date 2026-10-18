import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  codeForStatus,
  errorCode,
  errorStatus,
  toAppError,
  type ErrorResponse,
} from "../utils/errors/app.js";
import { BusinessError } from "../utils/errors/business.js";
import { SystemError } from "../utils/errors/system.js";
import type { ErrorCode } from "../utils/errors/codes.js";
import { getLanguageFromHeader, t } from "../utils/i18n/index.js";
import { Logger } from "../utils/logger.js";

/**
 * Global catch-all filter (docs/RESPONSES.md §7.2): every HTTP error leaves as
 * the shared envelope `{ success: false, code, message }`. Business errors keep
 * their meaningful code + localized message; system errors become generic
 * SERVICE_UNAVAILABLE/INTERNAL_SERVER_ERROR and their cause is logged, never
 * serialized to the client.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger(ErrorFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const error = toAppError(exception);
    const status = errorStatus(error);
    const code = errorCode(error);
    const header = request.headers["accept-language"];
    const lang = getLanguageFromHeader(Array.isArray(header) ? header[0] : header);
    const message = this.resolveMessage(error, code, status, lang);

    if (error instanceof SystemError) {
      this.logger.error(`System error (${code})`, {
        kind: error.kind,
        cause: error.cause ?? error,
      });
    } else {
      this.logger.warn(`Business error (${code})`, { status });
    }

    response.status(status).json({ success: false, code, message } satisfies ErrorResponse);
  }

  private resolveMessage(
    error: BusinessError | SystemError,
    code: ErrorCode,
    status: number,
    lang: string,
  ): string {
    if (error instanceof BusinessError && error.rawMessage !== undefined) {
      return error.rawMessage;
    }

    const translated = t(code, lang, error instanceof BusinessError ? error.params : undefined);
    if (translated !== code) {
      return translated;
    }

    return t(codeForStatus(status), lang);
  }
}
