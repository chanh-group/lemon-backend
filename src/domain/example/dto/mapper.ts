import { ExampleEntity } from "../repository.js";
import { ExampleResponse } from "./response.js";

export function toExampleResponse(entity: ExampleEntity): ExampleResponse {
  return {
    id: entity.id,
    name: entity.name,
  };
}
