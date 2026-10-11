import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { createPinoHttpConfig } from '../logger.config.js';
import { RequestLoggerMiddleware } from '../request-logger.middleware.js';

describe('RequestLoggerMiddleware (Native Pino-HTTP wrapper)', () => {
  it('should instantiate and execute next() function', () => {
    const middleware = new RequestLoggerMiddleware();

    const req = {
      headers: {},
      method: 'GET',
      url: '/api/v1/test',
    } as unknown as Request;

    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
    } as unknown as Response;

    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('Pino-HTTP Configuration Hooks', () => {
    const config = createPinoHttpConfig();

    it('genReqId should generate UUIDv7 and set x-request-id header when absent', () => {
      const setHeader = vi.fn();
      const req = { headers: {} } as unknown as IncomingMessage;
      const res = { setHeader } as unknown as ServerResponse;

      const genReqId = config.genReqId as (req: IncomingMessage, res: ServerResponse) => string;
      const id = genReqId(req, res);

      expect(typeof id).toBe('string');
      // UUID format check (8-4-4-4-12)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
    });

    it('genReqId should preserve incoming x-request-id header', () => {
      const setHeader = vi.fn();
      const req = {
        headers: { 'x-request-id': 'client-provided-id-999' },
      } as unknown as IncomingMessage;
      const res = { setHeader } as unknown as ServerResponse;

      const genReqId = config.genReqId as (req: IncomingMessage, res: ServerResponse) => string;
      const id = genReqId(req, res);

      expect(id).toBe('client-provided-id-999');
      expect(setHeader).toHaveBeenCalledWith('x-request-id', 'client-provided-id-999');
    });

    it('customLogLevel should map HTTP status correctly (severity mapping)', () => {
      const customLogLevel = config.customLogLevel as (
        req: IncomingMessage,
        res: ServerResponse,
        err?: unknown,
      ) => string;

      expect(customLogLevel({} as IncomingMessage, { statusCode: 200 } as ServerResponse)).toBe('info');
      expect(customLogLevel({} as IncomingMessage, { statusCode: 201 } as ServerResponse)).toBe('info');
      expect(customLogLevel({} as IncomingMessage, { statusCode: 400 } as ServerResponse)).toBe('warn');
      expect(customLogLevel({} as IncomingMessage, { statusCode: 404 } as ServerResponse)).toBe('warn');
      expect(customLogLevel({} as IncomingMessage, { statusCode: 500 } as ServerResponse)).toBe('error');
      expect(customLogLevel({} as IncomingMessage, { statusCode: 200 } as ServerResponse, new Error())).toBe('error');
    });

    it('customReceivedMessage and customSuccessMessage format messages cleanly', () => {
      const req = { method: 'POST', url: '/api/v1/messages', id: 'uuid-123' } as unknown as IncomingMessage;
      const res = { statusCode: 201 } as unknown as ServerResponse;

      const customReceived = config.customReceivedMessage as (req: IncomingMessage) => string;
      const customSuccess = config.customSuccessMessage as (
        req: IncomingMessage,
        res: ServerResponse,
        responseTime: number,
      ) => string;

      expect(customReceived(req)).toBe('http.request_incoming: --> POST /api/v1/messages (reqId: uuid-123)');
      expect(customSuccess(req, res, 15)).toBe(
        'http.request_completed: <-- POST /api/v1/messages 201 +15ms (reqId: uuid-123)',
      );
    });

    it('autoLogging.ignore should skip internal health endpoints', () => {
      const autoLogging = config.autoLogging as { ignore: (req: IncomingMessage) => boolean };

      expect(autoLogging.ignore({ url: '/health/live' } as IncomingMessage)).toBe(true);
      expect(autoLogging.ignore({ url: '/health/ready' } as IncomingMessage)).toBe(true);
      expect(autoLogging.ignore({ url: '/metrics' } as IncomingMessage)).toBe(true);
      expect(autoLogging.ignore({ url: '/api/v1/auth/login' } as IncomingMessage)).toBe(false);
    });
  });
});
