import { Injectable, LoggerService, Optional } from '@nestjs/common';
import type { Logger as PinoInstance } from 'pino';
import { createPinoLogger } from './logger.config.js';
import type {
  AppLoggerConfig,
  LogLevel,
  RequestLogInfo,
  ResponseLogInfo,
  StructuredLogPayload,
} from './logger.interface.js';

@Injectable()
export class AppLogger implements LoggerService {
  private pino: PinoInstance;
  private contextName?: string;

  constructor(@Optional() config?: AppLoggerConfig, @Optional() existingPino?: PinoInstance) {
    this.pino = existingPino ?? createPinoLogger(config);
  }

  setContext(context: string): this {
    this.contextName = context;
    return this;
  }

  child(bindings: Record<string, unknown>): AppLogger {
    const childPino = this.pino.child(bindings);
    const childLogger = new AppLogger(undefined, childPino);
    if (this.contextName) {
      childLogger.setContext(this.contextName);
    }
    return childLogger;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  info(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  /**
   * Log có cấu trúc chuẩn JSON theo quy ước LEMON CHAT (msg dạng domain.action)
   */
  logStructured(payload: StructuredLogPayload): void {
    const level: LogLevel = payload.level ?? 'info';
    const { msg, ...rest } = payload;
    const finalPayload = {
      context: this.contextName,
      ...rest,
    };

    if (level === 'fatal') {
      this.pino.fatal(finalPayload, msg);
    } else if (level === 'error') {
      this.pino.error(finalPayload, msg);
    } else if (level === 'warn') {
      this.pino.warn(finalPayload, msg);
    } else if (level === 'debug') {
      this.pino.debug(finalPayload, msg);
    } else if (level === 'trace') {
      this.pino.trace(finalPayload, msg);
    } else {
      this.pino.info(finalPayload, msg);
    }
  }

  /**
   * Ghi log khi request vừa đến:
   * - Thời gian đến (ngày giờ tháng năm dạng ISO)
   * - URL client gọi
   * - HTTP Method, Request ID, Client IP, User Agent
   */
  logRequestIncoming(info: RequestLogInfo): void {
    const summary = `--> ${info.method} ${info.url} [${info.dateTime}] (reqId: ${info.requestId})`;
    this.pino.info(
      {
        context: 'HTTP',
        requestId: info.requestId,
        method: info.method,
        url: info.url,
        dateTime: info.dateTime,
        timestamp: info.timestamp,
        ip: info.ip,
        userAgent: info.userAgent,
      },
      `http.request_incoming: ${summary}`,
    );
  }

  /**
   * Ghi log khi request đã xử lý xong:
   * - URL client gọi
   * - Status code, thời gian xử lý (durationMs)
   * - Thời gian hoàn tất (ngày giờ tháng năm)
   */
  logRequestCompleted(info: ResponseLogInfo): void {
    const summary = `<-- ${info.method} ${info.url} ${info.statusCode} +${info.durationMs}ms [${info.dateTime}] (reqId: ${info.requestId})`;
    const isError = info.statusCode >= 500;
    const isClientWarn = info.statusCode >= 400 && info.statusCode < 500;

    const payload = {
      context: 'HTTP',
      requestId: info.requestId,
      method: info.method,
      url: info.url,
      statusCode: info.statusCode,
      responseTime: info.durationMs,
      dateTime: info.dateTime,
      timestamp: info.timestamp,
    };

    const message = `http.request_completed: ${summary}`;

    if (isError) {
      this.pino.error(payload, message);
    } else if (isClientWarn) {
      this.pino.warn(payload, message);
    } else {
      this.pino.info(payload, message);
    }
  }

  private write(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams) ?? this.contextName;
    const meta = this.extractMeta(optionalParams);

    const payload: Record<string, unknown> = {
      context,
      ...meta,
    };

    const msgString = typeof message === 'string' ? message : JSON.stringify(message);

    if (level === 'fatal') {
      this.pino.fatal(payload, msgString);
    } else if (level === 'error') {
      this.pino.error(payload, msgString);
    } else if (level === 'warn') {
      this.pino.warn(payload, msgString);
    } else if (level === 'debug') {
      this.pino.debug(payload, msgString);
    } else if (level === 'trace') {
      this.pino.trace(payload, msgString);
    } else {
      this.pino.info(payload, msgString);
    }
  }

  private extractContext(params: unknown[]): string | undefined {
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      return params[params.length - 1] as string;
    }
    return undefined;
  }

  private extractMeta(params: unknown[]): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    for (const param of params) {
      if (typeof param === 'object' && param !== null) {
        Object.assign(meta, param);
      }
    }
    return meta;
  }
}
