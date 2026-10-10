export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface RequestLogInfo {
  requestId: string;
  method: string;
  url: string;
  ip?: string;
  userAgent?: string;
  /** Thời gian request đến theo định dạng ISO ngày giờ tháng năm (VD: 2026-10-10T13:45:00.000Z) */
  dateTime: string;
  /** Unix timestamp miliseconds khi request đến */
  timestamp: number;
}

export interface ResponseLogInfo {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  /** Thời gian xử lý request tính bằng mili-giây */
  durationMs: number;
  /** Thời gian request kết thúc theo định dạng ISO ngày giờ tháng năm */
  dateTime: string;
  /** Unix timestamp miliseconds khi request kết thúc */
  timestamp: number;
}

export interface ErrorLogTrace {
  name?: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export interface StructuredLogPayload {
  msg: string;
  level?: LogLevel;
  requestId?: string;
  userId?: string;
  context?: string;
  method?: string;
  url?: string;
  responseTime?: number;
  statusCode?: number;
  err?: ErrorLogTrace;
  [key: string]: unknown;
}

export interface AppLoggerConfig {
  logLevel?: LogLevel;
  isDevelopment?: boolean;
}
