import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/module.js";
import { ChatGateway } from "./chat.gateway.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  imports: [AuthModule],
  providers: [ChatGateway, RealtimeService],
  exports: [RealtimeService, ChatGateway],
})
export class RealtimeModule {}
