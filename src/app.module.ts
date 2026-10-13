import { Module } from '@nestjs/common';
import { ExampleModule } from './domain/example/example.module.js';
import { AppLoggerModule } from './utils/logger.module.js';

@Module({
  imports: [AppLoggerModule, ExampleModule],
})
export class AppModule {}
