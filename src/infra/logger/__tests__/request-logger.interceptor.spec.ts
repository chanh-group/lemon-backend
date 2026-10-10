import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppLogger } from '../logger.service.js';
import { RequestLoggerInterceptor } from '../request-logger.interceptor.js';

describe('RequestLoggerInterceptor (Independent Class)', () => {
  it('should capture incoming request info and log response duration on completion', async () => {
    const logger = new AppLogger();
    const incomingSpy = vi.spyOn(logger, 'logRequestIncoming');
    const completedSpy = vi.spyOn(logger, 'logRequestCompleted');

    const interceptor = new RequestLoggerInterceptor(logger);

    const req = {
      method: 'GET',
      url: '/api/v1/friends',
      originalUrl: '/api/v1/friends',
      headers: {},
      ip: '10.0.0.1',
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn().mockReturnValue(undefined),
      statusCode: 200,
    } as unknown as Response;

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    const callHandler: CallHandler = {
      handle: () => of({ success: true, data: [] }),
    };

    const observable = interceptor.intercept(context, callHandler);

    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: () => {},
        complete: () => resolve(),
        error: reject,
      });
    });

    expect(incomingSpy).toHaveBeenCalledTimes(1);
    const incomingData = incomingSpy.mock.calls[0][0];
    expect(incomingData.method).toBe('GET');
    expect(incomingData.url).toBe('/api/v1/friends');
    expect(incomingData.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    expect(completedSpy).toHaveBeenCalledTimes(1);
    const completedData = completedSpy.mock.calls[0][0];
    expect(completedData.method).toBe('GET');
    expect(completedData.url).toBe('/api/v1/friends');
    expect(completedData.statusCode).toBe(200);
    expect(completedData.durationMs).toBeGreaterThanOrEqual(0);
  });
});
