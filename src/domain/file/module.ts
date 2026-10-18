import { Module } from "@nestjs/common";
import { FileController } from "./controller.js";
import { FileService } from "./service.js";

@Module({
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}
