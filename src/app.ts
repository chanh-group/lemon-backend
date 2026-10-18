import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ExampleModule } from "./domain/example/module.js";
import { UserModule } from "./domain/user/module.js";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";

@Module({
  imports: [DatabaseModule, CacheModule, ExampleModule, UserModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
