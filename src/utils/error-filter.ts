import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { AppHttpException, type ErrorResponse } from "./response.js";

const logger = new Logger("ErrorFilter");

@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_SERVER_ERROR";
    let message = "Đã xảy ra lỗi máy chủ nội bộ";

    if (exception instanceof AppHttpException) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      if (status >= 500) {
        logger.error(`[${code}] ${message}`, exception.stack);
      } else {
        logger.warn(`[${code}] ${message}`);
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        message = res;
      } else if (typeof res === "object" && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body["message"] as string) || exception.message;
        code = (body["error"] as string)?.toUpperCase().replace(/\s+/g, "_") || "HTTP_ERROR";
      }
      logger.warn(`[${code}] ${message}`);
    } else if (exception instanceof Error) {
      const pgCode = (exception as any)?.code || (exception as any)?.cause?.code;
      if (pgCode === "22P02") {
        status = HttpStatus.BAD_REQUEST;
        code = "BAD_REQUEST";
        message = "Định dạng ID không hợp lệ (yêu cầu định dạng UUID)";
        logger.warn(`Invalid UUID input: ${exception.message}`);
      } else {
        logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
        message = "Đã xảy ra lỗi máy chủ nội bộ";
      }
    } else {
      logger.error(`Unknown Exception: ${String(exception)}`);
    }

    const payload: ErrorResponse = {
      success: false,
      code,
      message,
    };

    response.status(status).json(payload);
  }
}
