import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ExampleModule } from "./domain/example/example.module.js";
import { CacheModule } from "./configs/cache.module.js";
import { DatabaseModule } from "./configs/database.module.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.middleware.js";


@Module({
  imports: [DatabaseModule, CacheModule, ExampleModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}

