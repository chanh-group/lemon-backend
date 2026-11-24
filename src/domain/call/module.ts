import { Global, Module } from "@nestjs/common";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { ConversationModule } from "../conversation/module.js";
import { CALL_DISCONNECT_HANDLER } from "../realtime/constants.js";
import { RealtimeModule } from "../realtime/module.js";
import { UserModule } from "../user/module.js";
import { CallController } from "./controller.js";
import { CallPgRepository } from "./pg.js";
import { CALL_REPOSITORY } from "./repository.js";
import { CallService } from "./service.js";

// Global: call state is app-wide. The realtime gateway resolves
// CALL_DISCONNECT_HANDLER lazily (ModuleRef, strict: false) rather than by
// constructor injection, which cannot see another module's exports at boot.
@Global()
@Module({
  imports: [RealtimeModule, ConversationModule, UserModule, RateLimitModule],
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
