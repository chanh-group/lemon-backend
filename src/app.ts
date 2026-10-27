import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { MailModule } from "./configs/mail.js";
import { StorageModule } from "./configs/storage.js";
import { AuthGuard } from "./domain/auth/guards/authguard.js";
import { AuthModule } from "./domain/auth/module.js";
import { ConversationModule } from "./domain/conversation/module.js";
import { FileModule } from "./domain/file/module.js";
import { FriendModule } from "./domain/friend/module.js";
import { HealthModule } from "./domain/health/module.js";
import { MessageModule } from "./domain/message/module.js";
import { NoteModule } from "./domain/note/module.js";
import { RealtimeModule } from "./domain/realtime/realtime.module.js";
import { StoryModule } from "./domain/story/module.js";
import { UserModule } from "./domain/user/module.js";
import { PurgeModule } from "./jobs/purge/module.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";
import { RateLimitModule } from "./middleware/ratelimit.module.js";
import { RedisReadinessGuard } from "./middleware/redis-readiness.guard.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    CacheModule,
    StorageModule,
    MailModule,
    RateLimitModule,
    UserModule,
    AuthModule,
    HealthModule,
    RealtimeModule,
    ConversationModule,
    MessageModule,
    FriendModule,
    StoryModule,
    NoteModule,
    FileModule,
    PurgeModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RedisReadinessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("{*path}");
  }
}
