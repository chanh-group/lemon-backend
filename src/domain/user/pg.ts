import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, asc, eq, gt, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import type { UserRepository } from "./repository.js";
import type { NewUser, User } from "./schema.js";
import { users } from "./schema.js";
import { toCursorPage } from "../shared.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../pagination.constants.js";

function encodeSearchCursor(rank: number, id: string): string {
  return Buffer.from(`${rank}:${id}`).toString("base64url");
}

function decodeSearchCursor(cursor: string): { rank: number; id: string } | null {
  try {
    const [rank, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    const value = Number(rank);
    return Number.isInteger(value) && value >= 0 && value <= 3 && id ? { rank: value, id } : null;
  } catch {
    return null;
  }
}

function searchRank(user: User, query: string): number {
  if (user.username === query) return 0;
  if (user.username.startsWith(query)) return 1;
  if (user.fullName.toLowerCase().startsWith(query)) return 2;
  return 3;
}

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
    const clean = query.trim().toLowerCase().replaceAll("%", "\\%").replaceAll("_", "\\_");
    const pattern = `%${clean}%`;
    const prefix = `${clean}%`;
    const usernameRank = sql<number>`CASE
      WHEN ${users.username} = ${clean} THEN 0
      WHEN ${users.username} ILIKE ${prefix} THEN 1
      WHEN ${users.fullName} ILIKE ${prefix} THEN 2
      ELSE 3
    END`;
    const searchFilter =
      field === "email"
        ? ilike(sql<string>`${users.email}::text`, pattern)
        : or(ilike(users.username, pattern), ilike(users.fullName, pattern));
    const filters = [searchFilter, isNull(users.deletedAt)];
    if (excludeId) {
      filters.push(ne(users.id, excludeId));
    }
    if (cursor) {
      const decoded = decodeSearchCursor(cursor);
      if (decoded) {
        filters.push(
          or(
            gt(usernameRank, decoded.rank),
            and(eq(usernameRank, decoded.rank), gt(users.id, decoded.id)),
          )!,
        );
      }
    }
    const pageSize = Math.min(limit, MAX_PAGE_SIZE);
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...filters))
      .orderBy(field === "email" ? asc(users.id) : asc(usernameRank), asc(users.id))
      .limit(pageSize + 1);
    return toCursorPage(rows, pageSize, (user) =>
      field === "email" ? user.id : encodeSearchCursor(searchRank(user, clean), user.id),
    );
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
      .set({ passwordHash: hash, updatedAt: sql`now()` })
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
  }

  async updateProfile(
    id: string,
    data: Partial<Pick<User, "fullName" | "avatarUrl" | "bio" | "phone">>,
  ): Promise<User | null> {
    const [result] = await this.db
      .update(users)
      .set({ ...data, updatedAt: sql`now()` })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    return result ?? null;
  }

  async updateLastSeen(id: string, _lastSeenAt?: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ lastSeenAt: sql`now()` })
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, id));
  }
}
