import { DynamicModule, Global, Module } from '@nestjs/common';
import { LoggerModule as NestjsPinoLoggerModule } from 'nestjs-pino';
import { createPinoHttpConfig } from './logger.config.js';
import type { AppLoggerConfig } from './logger.interface.js';
import { AppLogger } from './logger.service.js';
import { RequestLoggerInterceptor } from './request-logger.interceptor.js';
import { RequestLoggerMiddleware } from './request-logger.middleware.js';

@Global()
@Module({
  providers: [AppLogger, RequestLoggerMiddleware, RequestLoggerInterceptor],
  exports: [AppLogger, RequestLoggerMiddleware, RequestLoggerInterceptor],
})
export class LoggerModule {
  /**
   * Cung cấp tùy chọn cấu hình động cho LoggerModule khi tích hợp vào hệ thống
   */
  static forRoot(config?: AppLoggerConfig): DynamicModule {
    const pinoHttp = createPinoHttpConfig(config);

    return {
      module: LoggerModule,
      imports: [
        NestjsPinoLoggerModule.forRoot({
          pinoHttp,
        }),
      ],
      providers: [
        {
          provide: AppLogger,
          useFactory: () => new AppLogger(config),
        },
        RequestLoggerMiddleware,
        RequestLoggerInterceptor,
      ],
      exports: [
        NestjsPinoLoggerModule,
        AppLogger,
        RequestLoggerMiddleware,
        RequestLoggerInterceptor,
      ],
    };
  }
}
