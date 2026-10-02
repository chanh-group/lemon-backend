import { Injectable } from '@nestjs/common';
import { ExampleEntity } from './example.entity.js';
import { ExampleRepository } from './example.repository.js';

@Injectable()
export class ExamplePgRepository implements ExampleRepository {
  async findAll(): Promise<ExampleEntity[]> {
    return [];
  }

  async findById(_id: string): Promise<ExampleEntity | null> {
    return null;
  }
}
