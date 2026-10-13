import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { DrizzleDb } from "../../configs/database.js";
import type { ExampleEntity } from "./repository.js";
import { ExampleRepository } from "./repository.js";

@Injectable()
export class ExamplePgRepository implements ExampleRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async findAll(): Promise<ExampleEntity[]> {
    return [];
  }

  async findById(_id: string): Promise<ExampleEntity | null> {
    return null;
  }
}
