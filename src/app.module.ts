import { Module } from "@nestjs/common";
import { ExampleModule } from "./domain/example/example.module.js";
import { CacheModule } from "./configs/cache.module.js";
import { DatabaseModule } from "./configs/database.module.js";

@Module({
  imports: [DatabaseModule, CacheModule, ExampleModule],
})
export class AppModule {}
