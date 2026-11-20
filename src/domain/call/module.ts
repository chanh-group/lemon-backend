import { forwardRef, Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { UserModule } from "../user/module.js";
import { CallController } from "./controller.js";
import { CallPgRepository } from "./pg.js";
import { CALL_REPOSITORY } from "./repository.js";
import { CallService } from "./service.js";

@Module({
  imports: [forwardRef(() => RealtimeModule), ConversationModule, UserModule],
  controllers: [CallController],
  providers: [
    {
      provide: CALL_REPOSITORY,
      useClass: CallPgRepository,
    },
    CallService,
  ],
  exports: [CALL_REPOSITORY, CallService],
})
export class CallModule {}
