import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ExampleModule } from "./domain/example/module.js";
import { StoryModule } from "./domain/story/module.js";
import { NoteModule } from "./domain/note/module.js";
import { FileModule } from "./domain/file/module.js";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
