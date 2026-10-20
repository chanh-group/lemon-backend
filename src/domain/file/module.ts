import { Module } from "@nestjs/common";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { FileController } from "./controller.js";
import { FileService } from "./service.js";

@Module({
  imports: [RateLimitModule],
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}
