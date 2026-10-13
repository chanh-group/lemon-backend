import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.module.js";
import type { User } from "./user.schema.js";
import type { UserRepository } from "./user.repository.js";
import { users } from "./user.schema.js";

@Injectable()
export class UserPgRepository implements UserRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<User | null> {
    const [result] = await this.db.select().from(users).where(eq(users.id, id));
    return result ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [result] = await this.db.select().from(users).where(eq(users.email, email));
    return result ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const [result] = await this.db.select().from(users).where(eq(users.username, username));
    return result ?? null;
  }
}
