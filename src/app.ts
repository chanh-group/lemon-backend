import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthGuard } from "./domain/auth/guards/authguard.js";
import { AuthModule } from "./domain/auth/module.js";
import { ExampleModule } from "./domain/example/module.js";
import { StoryModule } from "./domain/story/module.js";
import { NoteModule } from "./domain/note/module.js";
import { FileModule } from "./domain/file/module.js";
import { UserModule } from "./domain/user/module.js";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { MailModule } from "./configs/mail.js";
import { StorageModule } from "./configs/storage.js";
import { PurgeModule } from "./jobs/purge/module.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    CacheModule,
    StorageModule,
    ExampleModule,
    StoryModule,
    NoteModule,
    FileModule,
    PurgeModule,
    MailModule,
    UserModule,
    AuthModule,
  ],
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
