import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options as PinoHttpOptions } from 'pino-http';
import { pino } from 'pino';
import {
  DEFAULT_LOG_LEVEL,
  IGNORED_LOG_URLS,
  LOG_REDACT_CENSOR,
  LOG_REDACT_PATHS,
} from './logger.constants.js';
import type { AppLoggerConfig } from './logger.interface.js';

export function createPinoLogger(config?: AppLoggerConfig): pino.Logger {
  const isDev = config?.isDevelopment ?? process.env['APP_ENV'] === 'development';
  const level = config?.logLevel ?? (process.env['LOG_LEVEL'] as string) ?? DEFAULT_LOG_LEVEL;

  return pino({
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
  });
}

export function createPinoHttpConfig(config?: AppLoggerConfig): PinoHttpOptions {
  const isDev = config?.isDevelopment ?? process.env['APP_ENV'] === 'development';
  const level = config?.logLevel ?? (process.env['LOG_LEVEL'] as string) ?? DEFAULT_LOG_LEVEL;

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
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && incoming.trim() !== '' ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        id: req.id,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    redact: {
      paths: LOG_REDACT_PATHS,
      censor: LOG_REDACT_CENSOR,
    },
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        return IGNORED_LOG_URLS.some((ignored) => url.startsWith(ignored));
      },
    },
  };
}
