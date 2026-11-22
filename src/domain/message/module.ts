import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/module.js";
import { FriendModule } from "../friend/module.js";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { RealtimeModule } from "../realtime/module.js";
import { MessageController } from "./controller.js";
import { MessagePgRepository } from "./pg.js";
import { STORY_REPOSITORY } from "../story/repository.js";
import { StoryPgRepository } from "../story/pg.js";
import { MESSAGE_REPOSITORY } from "./repository.js";
import { MessageService } from "./service.js";

@Module({
  imports: [ConversationModule, FriendModule, RealtimeModule, RateLimitModule],
  controllers: [MessageController],
  providers: [
    {
      provide: MESSAGE_REPOSITORY,
      useClass: MessagePgRepository,
    },
    {
      // Registered here instead of importing StoryModule (which imports this
      // module) to avoid a circular module dependency.
      provide: STORY_REPOSITORY,
      useClass: StoryPgRepository,
    },
    MessageService,
  ],
  exports: [MESSAGE_REPOSITORY, MessageService],
})
export class MessageModule {}
