import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { AppLogger } from '../logger.service.js';
import { RequestLoggerMiddleware } from '../request-logger.middleware.js';

describe('RequestLoggerMiddleware (Independent Class)', () => {
  it('should intercept request, record incoming time & URL, and echo x-request-id', () => {
    const logger = new AppLogger();
    const incomingSpy = vi.spyOn(logger, 'logRequestIncoming');
    const completedSpy = vi.spyOn(logger, 'logRequestCompleted');

    const middleware = new RequestLoggerMiddleware(logger);

    const headers: Record<string, string> = {
      'user-agent': 'TestAgent/1.0',
    };
    const req = {
      method: 'POST',
      url: '/api/v1/auth/signup',
      originalUrl: '/api/v1/auth/signup',
      headers,
      ip: '192.168.1.1',
    } as unknown as Request;

    const resEmitter = new EventEmitter();
    const setHeaderMock = vi.fn();
    const res = Object.assign(resEmitter, {
      setHeader: setHeaderMock,
      statusCode: 201,
    }) as unknown as Response;

    const nextMock = vi.fn();

    middleware.use(req, res, nextMock);

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(setHeaderMock).toHaveBeenCalledWith('x-request-id', expect.any(String));

    // Kiểm tra incoming log
    expect(incomingSpy).toHaveBeenCalledTimes(1);
    const incomingCall = incomingSpy.mock.calls[0][0];
    expect(incomingCall.method).toBe('POST');
    expect(incomingCall.url).toBe('/api/v1/auth/signup');
    expect(incomingCall.ip).toBe('192.168.1.1');
    expect(incomingCall.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // Ngày giờ tháng năm dạng ISO
    expect(incomingCall.timestamp).toBeGreaterThan(0);
    expect(incomingCall.requestId).toBeDefined();

    // Giả lập response finish
    resEmitter.emit('finish');

    // Kiểm tra completed log
    expect(completedSpy).toHaveBeenCalledTimes(1);
    const completedCall = completedSpy.mock.calls[0][0];
    expect(completedCall.method).toBe('POST');
    expect(completedCall.url).toBe('/api/v1/auth/signup');
    expect(completedCall.statusCode).toBe(201);
    expect(completedCall.durationMs).toBeGreaterThanOrEqual(0);
    expect(completedCall.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should preserve incoming x-request-id header if present', () => {
    const logger = new AppLogger();
    const incomingSpy = vi.spyOn(logger, 'logRequestIncoming');
    const middleware = new RequestLoggerMiddleware(logger);

    const req = {
      method: 'GET',
      url: '/api/v1/users/search?q=lemon',
      originalUrl: '/api/v1/users/search?q=lemon',
      headers: { 'x-request-id': 'custom-client-id-777' },
    } as unknown as Request;

    const res = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(),
      statusCode: 200,
    }) as unknown as Response;

    middleware.use(req, res, vi.fn());

    expect(incomingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'custom-client-id-777',
        method: 'GET',
        url: '/api/v1/users/search?q=lemon',
      }),
    );
  });

  it('should skip logging for ignored URLs such as health checks', () => {
    const logger = new AppLogger();
    const incomingSpy = vi.spyOn(logger, 'logRequestIncoming');
    const middleware = new RequestLoggerMiddleware(logger);

    const req = {
      method: 'GET',
      url: '/health/live',
      headers: {},
    } as unknown as Request;

    const res = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(),
    }) as unknown as Response;

    const nextMock = vi.fn();
    middleware.use(req, res, nextMock);

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(incomingSpy).not.toHaveBeenCalled();
  });
});
