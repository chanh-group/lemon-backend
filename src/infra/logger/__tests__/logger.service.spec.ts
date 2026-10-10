import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../logger.service.js';

describe('AppLogger (Independent Service)', () => {
  it('should instantiate independently without any NestJS DI context', () => {
    const logger = new AppLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should support setting context and creating child loggers', () => {
    const logger = new AppLogger();
    logger.setContext('AuthService');
    const child = logger.child({ userId: '123' });
    expect(child).toBeDefined();
    expect(child).toBeInstanceOf(AppLogger);
  });

  it('should log request incoming with datetime, method, url, and requestId', () => {
    const logger = new AppLogger();
    const logSpy = vi.spyOn((logger as unknown as { pino: { info: () => void } }).pino, 'info');

    const incomingInfo = {
      requestId: 'req-uuid-1234',
      method: 'POST',
      url: '/api/v1/auth/login',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      dateTime: '2026-10-10T13:45:00.000Z',
      timestamp: 1759470000000,
    };

    logger.logRequestIncoming(incomingInfo);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'HTTP',
        requestId: 'req-uuid-1234',
        method: 'POST',
        url: '/api/v1/auth/login',
        dateTime: '2026-10-10T13:45:00.000Z',
        timestamp: 1759470000000,
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      }),
      expect.stringContaining('http.request_incoming: --> POST /api/v1/auth/login [2026-10-10T13:45:00.000Z] (reqId: req-uuid-1234)'),
    );
  });

  it('should log request completed with status 200 as info', () => {
    const logger = new AppLogger();
    const infoSpy = vi.spyOn((logger as unknown as { pino: { info: () => void } }).pino, 'info');

    const completedInfo = {
      requestId: 'req-uuid-1234',
      method: 'GET',
      url: '/api/v1/users/me',
      statusCode: 200,
      durationMs: 42,
      dateTime: '2026-10-10T13:45:01.000Z',
      timestamp: 1759470001000,
    };

    logger.logRequestCompleted(completedInfo);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'HTTP',
        requestId: 'req-uuid-1234',
        method: 'GET',
        url: '/api/v1/users/me',
        statusCode: 200,
        responseTime: 42,
        dateTime: '2026-10-10T13:45:01.000Z',
      }),
      expect.stringContaining('http.request_completed: <-- GET /api/v1/users/me 200 +42ms'),
    );
  });

  it('should log request completed with 4xx as warn and 5xx as error', () => {
    const logger = new AppLogger();
    const warnSpy = vi.spyOn((logger as unknown as { pino: { warn: () => void } }).pino, 'warn');
    const errorSpy = vi.spyOn((logger as unknown as { pino: { error: () => void } }).pino, 'error');

    logger.logRequestCompleted({
      requestId: 'req-400',
      method: 'POST',
      url: '/api/v1/auth/login',
      statusCode: 400,
      durationMs: 15,
      dateTime: '2026-10-10T13:45:00.000Z',
      timestamp: 1759470000000,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);

    logger.logRequestCompleted({
      requestId: 'req-500',
      method: 'GET',
      url: '/api/v1/messages',
      statusCode: 500,
      durationMs: 120,
      dateTime: '2026-10-10T13:45:01.000Z',
      timestamp: 1759470001000,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('should log structured messages according to lemon-chat specifications', () => {
    const logger = new AppLogger();
    const infoSpy = vi.spyOn((logger as unknown as { pino: { info: () => void } }).pino, 'info');

    logger.setContext('AuthService');
    logger.logStructured({
      msg: 'user.signed_in',
      userId: 'user-001',
      requestId: 'req-999',
      responseTime: 35,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'AuthService',
        userId: 'user-001',
        requestId: 'req-999',
        responseTime: 35,
      }),
      'user.signed_in',
    );
  });
});
