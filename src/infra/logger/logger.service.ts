import { Injectable, LoggerService, Optional } from '@nestjs/common';
import type { Logger as PinoInstance } from 'pino';
import { createPinoLogger } from './logger.config.js';
import type { AppLoggerConfig, StructuredLogPayload } from './logger.interface.js';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly pino: PinoInstance;

  constructor(
    @Optional() configOrPino?: AppLoggerConfig | PinoInstance,
  ) {
    if (configOrPino && typeof (configOrPino as PinoInstance).info === 'function') {
      this.pino = configOrPino as PinoInstance;
    } else {
      this.pino = createPinoLogger(configOrPino as AppLoggerConfig);
    }
  }

  /**
   * Tạo logger mới gắn context cố định (immutable), tránh mutate singleton instance
   */
  forContext(context: string): AppLogger {
    return new AppLogger(this.pino.child({ context }));
  }

  child(bindings: Record<string, unknown>): AppLogger {
    return new AppLogger(this.pino.child(bindings));
  }

  log(message: unknown, ...args: unknown[]): void {
    this.callPino('info', message, args);
  }

  info(message: unknown, ...args: unknown[]): void {
    this.callPino('info', message, args);
  }

  warn(message: unknown, ...args: unknown[]): void {
    this.callPino('warn', message, args);
  }

  error(message: unknown, ...args: unknown[]): void {
    this.callPino('error', message, args);
  }

  debug(message: unknown, ...args: unknown[]): void {
    this.callPino('debug', message, args);
  }

  verbose(message: unknown, ...args: unknown[]): void {
    this.callPino('trace', message, args);
  }

  fatal(message: unknown, ...args: unknown[]): void {
    this.callPino('fatal', message, args);
  }

  /**
   * Log có cấu trúc theo convention LEMON CHAT (msg dạng domain.action)
   */
  logStructured(payload: StructuredLogPayload): void {
    const { msg, level = 'info', ...rest } = payload;
    const fn = (this.pino[level] ?? this.pino.info).bind(this.pino) as (...a: unknown[]) => void;
    fn(rest, msg);
  }

  /**
   * Trả về instance Pino bên dưới khi cần gọi trực tiếp
   */
  get raw(): PinoInstance {
    return this.pino;
  }

  private callPino(
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
    message: unknown,
    args: unknown[],
  ): void {
    const fn = (this.pino[level] ?? this.pino.info).bind(this.pino) as (...a: unknown[]) => void;
    if (typeof message === 'object' && message !== null) {
      if (args.length > 0 && typeof args[0] === 'string') {
        fn(message, args[0], ...args.slice(1));
      } else {
        fn(message);
      }
    } else {
      fn(message, ...args);
    }
  }
}
