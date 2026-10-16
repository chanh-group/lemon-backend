import { User } from "./schema.js";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
}

export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
