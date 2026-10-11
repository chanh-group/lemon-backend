import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { pinoHttp, type HttpLogger } from 'pino-http';
import { createPinoHttpConfig } from './logger.config.js';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly httpLogger: HttpLogger;

  constructor() {
    this.httpLogger = pinoHttp(createPinoHttpConfig());
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.httpLogger(req, res, next);
  }
}
