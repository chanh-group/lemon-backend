import { Module } from "@nestjs/common";
import { StoryController } from "./controller.js";
import { StoryPgRepository } from "./pg.js";
import { STORY_REPOSITORY } from "./repository.js";
import { StoryService } from "./service.js";

@Module({
  controllers: [StoryController],
  providers: [
    StoryService,
    {
      provide: STORY_REPOSITORY,
      useClass: StoryPgRepository,
    },
  ],
  exports: [StoryService, STORY_REPOSITORY],
})
export class StoryModule {}
