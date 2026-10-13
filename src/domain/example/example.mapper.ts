import type { ExampleEntity } from './example.entity.js';
import type { ExampleResponse } from './example.response.js';

export function toExampleResponse(entity: ExampleEntity): ExampleResponse {
  return {
    id: entity.id,
    name: entity.name,
  };
}

