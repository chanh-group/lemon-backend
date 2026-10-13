import { ExampleEntity } from "../example.repository.js";
import { ExampleResponse } from "./example.response.js";

export function toExampleResponse(entity: ExampleEntity): ExampleResponse {
  return {
    id: entity.id,
    name: entity.name,
  };
}
