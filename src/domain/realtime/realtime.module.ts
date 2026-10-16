import { Module } from "@nestjs/common";
import { ChatGateway } from "./chat.gateway.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  providers: [ChatGateway, RealtimeService],
  exports: [RealtimeService, ChatGateway],
})
export class RealtimeModule {}

