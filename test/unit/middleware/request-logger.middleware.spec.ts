import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { RequestLoggerMiddleware } from '../../../src/middleware/request-logger.middleware.js';
import { createAppLogger, Logger } from '../../../src/utils/logger.js';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_TIMESTAMP_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

function captureStdout(run: () => void): string {
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  try {
    run();
    return writeSpy.mock.calls.map((call) => String(call[0])).join('');
  } finally {
    writeSpy.mockRestore();
  }
}

function captureStderr(run: () => void): string {
  const writeSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  try {
    run();
    return writeSpy.mock.calls.map((call) => String(call[0])).join('');
  } finally {
    writeSpy.mockRestore();
  }
}

describe('RequestLoggerMiddleware (Unit Tests)', () => {
  afterEach(() => {
    Logger.overrideLogger(false);
    vi.restoreAllMocks();
  });

  it('should call next() immediately when request arrives', () => {
    const middleware = new RequestLoggerMiddleware();
    const req = { method: 'GET', url: '/test' } as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    const next = vi.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should log 1 line on finish with stable message "Incoming request" and exact fields', () => {
    const logSpy = vi.fn();
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    const mockLogger = {
      log: logSpy,
      warn: warnSpy,
      error: errorSpy,
    } as unknown as Logger;

    const middleware = new RequestLoggerMiddleware(mockLogger);
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/items?filter=active&token=secret-token',
      headers: { authorization: 'Bearer sensitive-token' },
      body: { password: 'secret-password' },
    } as unknown as Request;

    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 200 }) as unknown as Response;
    const next = vi.fn();

    middleware.use(req, res, next);
    expect(logSpy).not.toHaveBeenCalled();

    resEmitter.emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    const [message, metadata] = logSpy.mock.calls[0] as [
      string,
      { durationMs: number; method: string; path: string; status: number },
    ];
    expect(message).toBe('Incoming request');
    expect(metadata).toEqual({
      method: 'GET',
      path: '/api/v1/items', // Stripped query string (no PII)
      status: 200,
      durationMs: expect.any(Number),
    });
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect((metadata as Record<string, unknown>)['headers']).toBeUndefined();
    expect((metadata as Record<string, unknown>)['body']).toBeUndefined();
  });

  it('should map HTTP status codes to correct log levels: log (<400), warn (4xx), error (5xx)', () => {
    const logSpy = vi.fn();
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    const mockLogger = {
      log: logSpy,
      warn: warnSpy,
      error: errorSpy,
    } as unknown as Logger;

    const middleware = new RequestLoggerMiddleware(mockLogger);

    // 1. Success 200 -> log
    const res200 = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    middleware.use({ method: 'GET', originalUrl: '/ok' } as Request, res200, vi.fn());
    res200.emit('finish');
    expect(logSpy).toHaveBeenCalledWith('Incoming request', {
      method: 'GET',
      path: '/ok',
      status: 200,
      durationMs: expect.any(Number),
    });

    // 2. Client error 404 -> warn
    const res404 = Object.assign(new EventEmitter(), { statusCode: 404 }) as unknown as Response;
    middleware.use({ method: 'GET', originalUrl: '/not-found' } as Request, res404, vi.fn());
    res404.emit('finish');
    expect(warnSpy).toHaveBeenCalledWith('Incoming request', {
      method: 'GET',
      path: '/not-found',
      status: 404,
      durationMs: expect.any(Number),
    });

    // 3. Server error 500 -> error
    const res500 = Object.assign(new EventEmitter(), { statusCode: 500 }) as unknown as Response;
    middleware.use({ method: 'POST', originalUrl: '/error' } as Request, res500, vi.fn());
    res500.emit('finish');
    expect(errorSpy).toHaveBeenCalledWith('Incoming request', {
      method: 'POST',
      path: '/error',
      status: 500,
      durationMs: expect.any(Number),
    });
  });

  it('should capture stdout in development mode and format human-readable output with ISO timestamp', () => {
    Logger.overrideLogger(createAppLogger('development'));

    const middleware = new RequestLoggerMiddleware();
    const req = { method: 'GET', originalUrl: '/dev-route' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 200 }) as unknown as Response;

    const output = captureStdout(() => {
      middleware.use(req, res, vi.fn());
      resEmitter.emit('finish');
    });

    expect(output).toMatch(ISO_TIMESTAMP_IN_TEXT);
    expect(output).toContain('LOG');
    expect(output).toContain('[RequestLoggerMiddleware]');
    expect(output).toContain('Incoming request');
    expect(output).toContain('/dev-route');
    expect(output).toContain('200');
  });

  it('should capture stdout in production mode and assert 1 single JSON line for access log (<400)', () => {
    Logger.overrideLogger(createAppLogger('production'));

    const middleware = new RequestLoggerMiddleware();
    const req = { method: 'GET', originalUrl: '/api/v1/ping' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 200 }) as unknown as Response;

    const output = captureStdout(() => {
      middleware.use(req, res, vi.fn());
      resEmitter.emit('finish');
    });

    expect(output.endsWith('\n')).toBe(true);
    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(1);

    const json = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(json['level']).toBe('log');
    expect(json['message']).toBe('Incoming request');
    expect(json['context']).toBe('RequestLoggerMiddleware');
    expect(json['timestamp']).toMatch(ISO_TIMESTAMP);
    expect(json['params']).toEqual({
      method: 'GET',
      path: '/api/v1/ping',
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it('should capture stdout in production mode for 4xx warning as 1 single JSON line', () => {
    Logger.overrideLogger(createAppLogger('production'));

    const middleware = new RequestLoggerMiddleware();
    const req = { method: 'POST', originalUrl: '/auth/login' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 401 }) as unknown as Response;

    const output = captureStdout(() => {
      middleware.use(req, res, vi.fn());
      resEmitter.emit('finish');
    });

    expect(output.endsWith('\n')).toBe(true);
    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(1);

    const json = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(json['level']).toBe('warn');
    expect(json['message']).toBe('Incoming request');
    expect(json['context']).toBe('RequestLoggerMiddleware');
    expect(json['timestamp']).toMatch(ISO_TIMESTAMP);
    expect(json['params']).toEqual({
      method: 'POST',
      path: '/auth/login',
      status: 401,
      durationMs: expect.any(Number),
    });
  });

  it('should capture stderr in production mode for 5xx error as 1 single JSON line', () => {
    Logger.overrideLogger(createAppLogger('production'));

    const middleware = new RequestLoggerMiddleware();
    const req = { method: 'GET', originalUrl: '/crash' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 503 }) as unknown as Response;

    const output = captureStderr(() => {
      middleware.use(req, res, vi.fn());
      resEmitter.emit('finish');
    });

    expect(output.endsWith('\n')).toBe(true);
    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(1);

    const json = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(json['level']).toBe('error');
    expect(json['message']).toBe('Incoming request');
    expect(json['context']).toBe('RequestLoggerMiddleware');
    expect(json['timestamp']).toMatch(ISO_TIMESTAMP);
    expect(json['params']).toEqual({
      method: 'GET',
      path: '/crash',
      status: 503,
      durationMs: expect.any(Number),
    });
  });

  it('should not log duplicate lines if both finish and close events fire', () => {
    const logSpy = vi.fn();
    const mockLogger = {
      log: logSpy,
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const middleware = new RequestLoggerMiddleware(mockLogger);
    const req = { method: 'GET', url: '/once' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 200 }) as unknown as Response;

    middleware.use(req, res, vi.fn());
    resEmitter.emit('finish');
    resEmitter.emit('close');

    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle premature close event if finish was not emitted', () => {
    const logSpy = vi.fn();
    const mockLogger = {
      log: logSpy,
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const middleware = new RequestLoggerMiddleware(mockLogger);
    const req = { method: 'GET', url: '/aborted' } as Request;
    const resEmitter = new EventEmitter();
    const res = Object.assign(resEmitter, { statusCode: 200 }) as unknown as Response;

    middleware.use(req, res, vi.fn());
    resEmitter.emit('close');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Incoming request', {
      method: 'GET',
      path: '/aborted',
      status: 200,
      durationMs: expect.any(Number),
    });
  });
});
