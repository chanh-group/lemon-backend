import type { LevelWithSilent } from 'pino';

export type LogLevel = LevelWithSilent;

export interface AppLoggerConfig {
  logLevel?: LogLevel;
  isDevelopment?: boolean;
}

export interface StructuredLogPayload {
  msg: string;
  level?: LogLevel;
  requestId?: string;
  userId?: string;
  context?: string;
  [key: string]: unknown;
}
