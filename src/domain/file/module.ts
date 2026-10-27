import { Module } from "@nestjs/common";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { FileController } from "./controller.js";
import { FileService } from "./service.js";
import { UploadRateLimitInterceptor } from "./upload-rate-limit.interceptor.js";

@Module({
  imports: [RateLimitModule],
  controllers: [FileController],
  providers: [FileService, UploadRateLimitInterceptor],
})
export class FileModule {}
