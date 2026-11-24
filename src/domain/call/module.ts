import { Global, Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/module.js";
import { CALL_DISCONNECT_HANDLER } from "../realtime/constants.js";
import { RealtimeModule } from "../realtime/module.js";
import { UserModule } from "../user/module.js";
import { CallController } from "./controller.js";
import { CallPgRepository } from "./pg.js";
import { CALL_REPOSITORY } from "./repository.js";
import { CallService } from "./service.js";

// Global so ChatGateway (in RealtimeModule, which this module imports) can inject
// CALL_DISCONNECT_HANDLER without a circular module import.
@Global()
@Module({
  imports: [RealtimeModule, ConversationModule, UserModule],
  controllers: [CallController],
  providers: [
    {
      provide: CALL_REPOSITORY,
      useClass: CallPgRepository,
    },
    CallService,
    {
      provide: CALL_DISCONNECT_HANDLER,
      useExisting: CallService,
    },
  ],
  exports: [CALL_REPOSITORY, CallService, CALL_DISCONNECT_HANDLER],
})
export class CallModule {}
