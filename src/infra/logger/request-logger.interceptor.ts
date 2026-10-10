import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HEADER_REQUEST_ID, IGNORED_LOG_URLS } from './logger.constants.js';
import { AppLogger } from './logger.service.js';

@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly appLogger: AppLogger;

  constructor(@Optional() logger?: AppLogger) {
    this.appLogger = logger ?? new AppLogger();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const contextType = context.getType();

    if (contextType !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const rawUrl = req.originalUrl || req.url || '/';

    if (IGNORED_LOG_URLS.some((ignored) => rawUrl.startsWith(ignored))) {
      return next.handle();
    }

    const incomingReqId = req.headers?.[HEADER_REQUEST_ID];
    const requestId =
      typeof incomingReqId === 'string' && incomingReqId.trim() !== ''
        ? incomingReqId
        : (req as Request & { id?: string }).id || randomUUID();

    if (res.setHeader && !res.getHeader(HEADER_REQUEST_ID)) {
      res.setHeader(HEADER_REQUEST_ID, requestId);
    }

    const startTime = Date.now();
    const dateTime = new Date(startTime).toISOString();
    const method = req.method;
    const url = rawUrl;
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = (req.headers?.['user-agent'] as string) || undefined;

    this.appLogger.logRequestIncoming({
      requestId,
      method,
      url,
      ip,
      userAgent,
      dateTime,
      timestamp: startTime,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const endTime = Date.now();
          const durationMs = endTime - startTime;
          const completedDateTime = new Date(endTime).toISOString();

          this.appLogger.logRequestCompleted({
            requestId,
            method,
            url,
            statusCode: res.statusCode ?? 200,
            durationMs,
            dateTime: completedDateTime,
            timestamp: endTime,
          });
        },
        error: (err: unknown) => {
          const endTime = Date.now();
          const durationMs = endTime - startTime;
          const completedDateTime = new Date(endTime).toISOString();
          const statusCode =
            typeof err === 'object' && err !== null && 'status' in err
              ? (err as { status: number }).status
              : 500;

          this.appLogger.logRequestCompleted({
            requestId,
            method,
            url,
            statusCode,
            durationMs,
            dateTime: completedDateTime,
            timestamp: endTime,
          });
        },
      }),
    );
  }
}
