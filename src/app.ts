import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { ConversationModule } from "./domain/conversation/module.js";
import { ExampleModule } from "./domain/example/module.js";
import { MessageModule } from "./domain/message/module.js";
import { RealtimeModule } from "./domain/realtime/realtime.module.js";
import { UserModule } from "./domain/user/module.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";

@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    UserModule,
    RealtimeModule,
    ConversationModule,
    MessageModule,
    ExampleModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
