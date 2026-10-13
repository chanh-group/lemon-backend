import { ConsoleLogger, ConsoleLoggerOptions, Module } from '@nestjs/common';

export const APP_LOGGER_OPTIONS = Symbol('APP_LOGGER_OPTIONS');

export class AppLogger extends ConsoleLogger {
  override getTimestamp(): string {
    return new Date().toISOString();
  }

  getOptions(): ConsoleLoggerOptions {
    return this.options;
  }
}

export function createAppLoggerOptions(
  env: string = process.env['NODE_ENV'] ?? 'development',
): ConsoleLoggerOptions {
  const isProduction = env === 'production';

  if (isProduction) {
    return {
      json: true,
      colors: false,
      logLevels: ['log', 'error', 'warn', 'fatal'],
    };
  }

  return {
    json: false,
    colors: true,
    logLevels: ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'],
  };
}

export function createAppLogger(
  env: string = process.env['NODE_ENV'] ?? 'development',
): AppLogger {
  return new AppLogger(createAppLoggerOptions(env));
}

@Module({
  providers: [
    {
      provide: APP_LOGGER_OPTIONS,
      useFactory: () => createAppLoggerOptions(),
    },
    {
      provide: AppLogger,
      useFactory: () => createAppLogger(),
    },
  ],
  exports: [APP_LOGGER_OPTIONS, AppLogger],
})
export class AppLoggerModule {}
