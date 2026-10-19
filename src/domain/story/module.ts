import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/module.js";
import { MessageModule } from "../message/module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { StoryController } from "./controller.js";
import { StoryPgRepository } from "./pg.js";
import { STORY_REPOSITORY } from "./repository.js";
import { StoryService } from "./service.js";

@Module({
  imports: [ConversationModule, MessageModule, RealtimeModule],
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
