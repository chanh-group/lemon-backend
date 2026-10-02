import { ExampleEntity } from './example.entity.js';

// May be used abstract class or interface, depending on your needs.
// Here, we use an interface for simplicity.

export interface ExampleRepository {
  findAll(): Promise<ExampleEntity[]>;
  findById(id: string): Promise<ExampleEntity | null>;
}

export const EXAMPLE_REPOSITORY = Symbol('EXAMPLE_REPOSITORY');
