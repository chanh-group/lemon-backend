import { DynamicModule, Global, Module } from '@nestjs/common';
import { LoggerModule as NestjsPinoLoggerModule } from 'nestjs-pino';
import { createPinoHttpConfig } from './logger.config.js';
import type { AppLoggerConfig } from './logger.interface.js';
import { AppLogger } from './logger.service.js';
import { RequestLoggerMiddleware } from './request-logger.middleware.js';

@Global()
@Module({
  providers: [AppLogger, RequestLoggerMiddleware],
  exports: [AppLogger, RequestLoggerMiddleware],
})
export class LoggerModule {
  static forRoot(config?: AppLoggerConfig): DynamicModule {
    return {
      module: LoggerModule,
      imports: [
        NestjsPinoLoggerModule.forRoot({
          pinoHttp: createPinoHttpConfig(config),
        }),
      ],
      providers: [
        {
          provide: AppLogger,
          useFactory: () => new AppLogger(config),
        },
        RequestLoggerMiddleware,
      ],
      exports: [NestjsPinoLoggerModule, AppLogger, RequestLoggerMiddleware],
    };
  }
}
