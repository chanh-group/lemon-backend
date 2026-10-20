import type { NewUser, User } from "./schema.js";
import type { CursorPage } from "../shared.js";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByIdentifier(identifier: string): Promise<User | null>;
  search(
    query: string,
    field: "email" | "username",
    excludeId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<User>>;
  create(data: NewUser): Promise<User>;
  updatePasswordHash(id: string, hash: string): Promise<void>;
  updateProfile(
    id: string,
    data: Partial<Pick<User, "fullName" | "avatarUrl" | "bio" | "phone">>,
  ): Promise<User | null>;
  updateLastSeen(id: string, lastSeenAt?: Date): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
