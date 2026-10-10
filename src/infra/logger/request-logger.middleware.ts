import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HEADER_REQUEST_ID, IGNORED_LOG_URLS } from './logger.constants.js';
import { AppLogger } from './logger.service.js';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly appLogger: AppLogger;

  constructor(@Optional() logger?: AppLogger) {
    this.appLogger = logger ?? new AppLogger();
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const rawUrl = req.originalUrl || req.url || '/';

    // Bỏ qua các URL kiểm tra sức khỏe tự động theo docs/SETUP.md §3.1
    if (IGNORED_LOG_URLS.some((ignored) => rawUrl.startsWith(ignored))) {
      return next();
    }

    // 1. Nhận hoặc sinh mới Request ID
    const incomingReqId = req.headers[HEADER_REQUEST_ID];
    const requestId =
      typeof incomingReqId === 'string' && incomingReqId.trim() !== ''
        ? incomingReqId
        : randomUUID();

    // Echo x-request-id về client để đối chiếu ticket lỗi khi cần
    res.setHeader(HEADER_REQUEST_ID, requestId);
    (req as Request & { id?: string }).id = requestId;

    // 2. Ghi nhận thời gian đến, ngày giờ tháng năm, URL client gọi
    const startTime = Date.now();
    const requestDate = new Date(startTime);
    const dateTime = requestDate.toISOString(); // Định dạng ISO: YYYY-MM-DDTHH:mm:ss.sssZ (đầy đủ ngày giờ tháng năm)
    const method = req.method;
    const url = rawUrl;
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = (req.headers['user-agent'] as string) || undefined;

    this.appLogger.logRequestIncoming({
      requestId,
      method,
      url,
      ip,
      userAgent,
      dateTime,
      timestamp: startTime,
    });

    // 3. Lắng nghe khi response hoàn tất để ghi nhận thời gian xử lý và trạng thái
    res.on('finish', () => {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const completedDateTime = new Date(endTime).toISOString();

      this.appLogger.logRequestCompleted({
        requestId,
        method,
        url,
        statusCode: res.statusCode,
        durationMs,
        dateTime: completedDateTime,
        timestamp: endTime,
      });
    });

    next();
  }
}
