import { Module } from '@nestjs/common';
import { ExampleModule } from './domain/example/example.module.js';
import { DatabaseModule } from './configs/database.module.js';

@Module({
  imports: [DatabaseModule, ExampleModule],
})
export class AppModule {}
