import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ExampleModule } from "./domain/example/module.js";
import { StoryModule } from "./domain/story/module.js";
import { NoteModule } from "./domain/note/module.js";
import { CacheModule } from "./configs/cache.js";
import { DatabaseModule } from "./configs/database.js";
import { StorageModule } from "./configs/storage.js";
import { RequestLoggerMiddleware } from "./middleware/request-logger.js";

@Module({
  imports: [DatabaseModule, CacheModule, StorageModule, ExampleModule, StoryModule, NoteModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
