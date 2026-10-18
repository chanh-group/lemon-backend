import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./domain/auth/guards/authguard.js";
import { AuthModule } from "./domain/auth/module.js";
import { ExampleModule } from "./domain/example/module.js";
import { UserModule } from "./domain/user/module.js";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { MailModule } from "./configs/mail.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";

@Module({
  imports: [DatabaseModule, CacheModule, MailModule, ExampleModule, UserModule, AuthModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
