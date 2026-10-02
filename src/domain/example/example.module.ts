import { Module } from '@nestjs/common';
import { ExampleController } from './example.controller.js';
import { ExamplePgRepository } from './example.pg.js';
import { EXAMPLE_REPOSITORY } from './example.repository.js';
import { ExampleService } from './example.service.js';

@Module({
  controllers: [ExampleController],
  providers: [
    ExampleService,
    { provide: EXAMPLE_REPOSITORY, useClass: ExamplePgRepository },
  ],
})
export class ExampleModule {}
