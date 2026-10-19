import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { UserModule } from "../user/module.js";
import { FriendController } from "./controller.js";
import { FRIEND_REPOSITORY } from "./repository.js";
import { FriendPgRepository } from "./pg.js";
import { FriendService } from "./service.js";

@Module({
  imports: [UserModule, RealtimeModule],
  controllers: [FriendController],
  providers: [
    {
      provide: FRIEND_REPOSITORY,
      useClass: FriendPgRepository,
    },
    FriendService,
  ],
  exports: [FriendService],
})
export class FriendModule {}
