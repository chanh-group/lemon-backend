import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, eq, gt, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import type { UserRepository } from "./repository.js";
import type { NewUser, User } from "./schema.js";
import { users } from "./schema.js";
import { toCursorPage } from "../shared.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../pagination.constants.js";

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

  async search(
    query: string,
    field: "email" | "username",
    excludeId?: string,
    cursor?: string,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    const pattern = `%${query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const searchColumn = field === "email" ? sql<string>`${users.email}::text` : users.username;
    const filters = [ilike(searchColumn, pattern), isNull(users.deletedAt)];
    if (excludeId) {
      filters.push(ne(users.id, excludeId));
    }
    if (cursor) filters.push(gt(users.id, cursor));
    const pageSize = Math.min(limit, MAX_PAGE_SIZE);
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...filters))
      .orderBy(asc(users.id))
      .limit(pageSize + 1);
    return toCursorPage(rows, pageSize, (user) => user.id);
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
