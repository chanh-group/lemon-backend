import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull, or } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import type { UserRepository } from "./repository.js";
import type { NewUser, User } from "./schema.js";
import { users } from "./schema.js";

@Injectable()
export class UserPgRepository implements UserRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<User | null> {
    const [result] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return result ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [result] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email.toLowerCase().trim()), isNull(users.deletedAt)));
    return result ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const [result] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username.toLowerCase().trim()), isNull(users.deletedAt)));
    return result ?? null;
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    const clean = identifier.toLowerCase().trim();
    const [result] = await this.db
      .select()
      .from(users)
      .where(and(or(eq(users.email, clean), eq(users.username, clean)), isNull(users.deletedAt)));
    return result ?? null;
  }

  async create(data: NewUser): Promise<User> {
    const [result] = await this.db
      .insert(users)
      .values({
        ...data,
        email: data.email.toLowerCase().trim(),
        username: data.username.toLowerCase().trim(),
      })
      .returning();
    return result;
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
  }

  async updateProfile(
    id: string,
    data: Partial<Pick<User, "fullName" | "avatarUrl" | "bio" | "phone">>,
  ): Promise<User | null> {
    const [result] = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    return result ?? null;
  }

  async updateLastSeen(id: string, lastSeenAt: Date = new Date()): Promise<void> {
    await this.db
      .update(users)
      .set({ lastSeenAt })
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }
}
