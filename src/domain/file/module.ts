import { Module } from "@nestjs/common";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { FileController } from "./controller.js";
import { FileService } from "./service.js";
import { UploadRateLimitInterceptor } from "./upload-rate-limit.interceptor.js";
import { ConversationModule } from "../conversation/module.js";

@Module({
  imports: [RateLimitModule, ConversationModule],
  controllers: [FileController],
  providers: [FileService, UploadRateLimitInterceptor],
})
export class FileModule {}
