import { Module } from "@nestjs/common";
import { ExampleController } from "./controller.js";
import { ExamplePgRepository } from "./pg.js";
import { EXAMPLE_REPOSITORY } from "./repository.js";
import { ExampleService } from "./service.js";

@Module({
  controllers: [ExampleController],
  providers: [ExampleService, { provide: EXAMPLE_REPOSITORY, useClass: ExamplePgRepository }],
})
export class ExampleModule {}
