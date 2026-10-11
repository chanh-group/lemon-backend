import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { v7 as uuidv7 } from 'uuid';
import {
  DEFAULT_LOG_LEVEL,
  HEADER_REQUEST_ID,
  IGNORED_LOG_URLS,
  LOG_REDACT_CENSOR,
  LOG_REDACT_PATHS,
} from './logger.constants.js';
import type { AppLoggerConfig, LogLevel } from './logger.interface.js';

/**
 * Resolver duy nhất cho các cấu hình dùng chung giữa Pino và Pino-HTTP
 */
export function resolveLoggerCoreOptions(config?: AppLoggerConfig): pino.LoggerOptions {
  const isDev = config?.isDevelopment ?? process.env['APP_ENV'] === 'development';
  const level = config?.logLevel ?? (process.env['LOG_LEVEL'] as LogLevel) ?? DEFAULT_LOG_LEVEL;

  return {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    redact: {
      paths: LOG_REDACT_PATHS,
      censor: LOG_REDACT_CENSOR,
    },
  };
}

export function createPinoLogger(config?: AppLoggerConfig): pino.Logger {
  return pino(resolveLoggerCoreOptions(config));
}

export function createPinoHttpConfig(config?: AppLoggerConfig): PinoHttpOptions {
  const coreOptions = resolveLoggerCoreOptions(config);

  return {
    ...coreOptions,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = (req as IncomingMessage & { id?: string }).id ?? req.headers[HEADER_REQUEST_ID];
      const id = typeof incoming === 'string' && incoming.trim() !== '' ? incoming : uuidv7();
      res.setHeader(HEADER_REQUEST_ID, id);
      return id;
    },
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: unknown) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customReceivedMessage: (req: IncomingMessage) =>
      `http.request_incoming: --> ${req.method} ${req.url} (reqId: ${(req as IncomingMessage & { id?: string }).id})`,
    customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) =>
      `http.request_completed: <-- ${req.method} ${req.url} ${res.statusCode} +${responseTime}ms (reqId: ${(req as IncomingMessage & { id?: string }).id})`,
    customErrorMessage: (req: IncomingMessage, res: ServerResponse) =>
      `http.request_errored: <-- ${req.method} ${req.url} ${res.statusCode} (reqId: ${(req as IncomingMessage & { id?: string }).id})`,
    autoLogging: {
      ignore: (req: IncomingMessage) => {
        const url = req.url ?? '';
        return IGNORED_LOG_URLS.some((ignored) => url.startsWith(ignored));
      },
    },
  };
}
