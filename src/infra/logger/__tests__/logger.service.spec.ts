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

  it('should create immutable child logger with forContext without mutating parent', () => {
    const logger = new AppLogger();
    const child = logger.forContext('AuthService');

    expect(child).toBeDefined();
    expect(child).toBeInstanceOf(AppLogger);
    expect(child).not.toBe(logger);
  });

  it('should support child logger creation', () => {
    const logger = new AppLogger();
    const child = logger.child({ userId: '123' });
    expect(child).toBeDefined();
    expect(child).toBeInstanceOf(AppLogger);
  });

  it('should not throw on circular object logging (regression test)', () => {
    const logger = new AppLogger();
    const circular: { name: string; self?: unknown } = { name: 'circular-test' };
    circular.self = circular;

    expect(() => {
      logger.info(circular, 'testing circular object');
    }).not.toThrow();
  });

  it('should forward calls directly to underlying pino instance', () => {
    const logger = new AppLogger();
    const infoSpy = vi.spyOn(logger.raw, 'info');
    const warnSpy = vi.spyOn(logger.raw, 'warn');
    const errorSpy = vi.spyOn(logger.raw, 'error');

    logger.info('hello info');
    expect(infoSpy).toHaveBeenCalledWith('hello info');

    logger.warn({ code: 'WARN_CODE' }, 'hello warn');
    expect(warnSpy).toHaveBeenCalledWith({ code: 'WARN_CODE' }, 'hello warn');

    logger.error(new Error('boom'), 'hello error');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should log structured messages according to lemon-chat domain.action convention', () => {
    const logger = new AppLogger();
    const infoSpy = vi.spyOn(logger.raw, 'info');

    logger.logStructured({
      msg: 'user.signed_in',
      userId: 'user-001',
      requestId: 'req-999',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        requestId: 'req-999',
      }),
      'user.signed_in',
    );
  });
});
