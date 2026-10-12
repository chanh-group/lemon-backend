import { describe, expect, it } from 'vitest';
import { ConsoleLogger } from '@nestjs/common';
import {
  AppLogger,
  createAppLogger,
  createAppLoggerOptions,
  APP_LOGGER_OPTIONS,
  AppLoggerModule,
} from './logger.module.js';

describe('AppLoggerModule & createAppLoggerOptions (Task 1)', () => {
  it('should return json: false and colors: true in development environment', () => {
    const devOptions = createAppLoggerOptions('development');
    expect(devOptions.json).toBe(false);
    expect(devOptions.colors).toBe(true);
  });

  it('should return json: true, colors: false, and production logLevels in production environment', () => {
    const prodOptions = createAppLoggerOptions('production');
    expect(prodOptions.json).toBe(true);
    expect(prodOptions.colors).toBe(false);
    expect(prodOptions.logLevels).toContain('log');
    expect(prodOptions.logLevels).toContain('error');
    expect(prodOptions.logLevels).toContain('warn');
    expect(prodOptions.logLevels).not.toContain('debug');
  });

  it('AppLogger should extend ConsoleLogger and return ISO timestamp in getTimestamp()', () => {
    const logger = new AppLogger();
    expect(logger).toBeInstanceOf(ConsoleLogger);

    const timestamp = logger.getTimestamp();
    // Validate ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('createAppLogger should return AppLogger with appropriate options', () => {
    const devLogger = createAppLogger('development');
    expect(devLogger).toBeInstanceOf(AppLogger);
    expect(devLogger.getOptions().json).toBe(false);

    const prodLogger = createAppLogger('production');
    expect(prodLogger).toBeInstanceOf(AppLogger);
    expect(prodLogger.getOptions().json).toBe(true);
  });

  it('AppLoggerModule should provide APP_LOGGER_OPTIONS token', () => {
    expect(APP_LOGGER_OPTIONS).toBeDefined();
    expect(AppLoggerModule).toBeDefined();
  });
});
