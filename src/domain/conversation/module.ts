import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { UserModule } from "../user/module.js";
import { ConversationController } from "./controller.js";
import { ConversationPgRepository } from "./pg.js";
import { CONVERSATION_REPOSITORY } from "./repository.js";
import { ConversationService } from "./service.js";

@Module({
  imports: [UserModule, RealtimeModule],
  controllers: [ConversationController],
  providers: [
    {
      provide: CONVERSATION_REPOSITORY,
      useClass: ConversationPgRepository,
    },
    ConversationService,
  ],
  exports: [CONVERSATION_REPOSITORY, ConversationService],
})
export class ConversationModule {}
