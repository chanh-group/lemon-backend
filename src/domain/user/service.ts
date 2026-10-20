import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CreateUserInput,
  createUserSchema,
  UpdateUserInput,
  updateUserSchema,
} from "./dto/request.js";
import { toUserResponse } from "./dto/mapper.js";
import type { UserResponseDto } from "./dto/response.js";
import { USER_REPOSITORY } from "./repository.js";
import type { UserRepository } from "./repository.js";
import type { User } from "./schema.js";
import { BusinessError } from "../../utils/errors/business.js";
import { mapUniqueViolation } from "../../utils/errors/pg.js";
import { parseSchemaIssues } from "../../utils/validation.js";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findByEmail(email);
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findByUsername(username);
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    return this.userRepo.findByIdentifier(identifier);
  }

  async search(
    query: string,
    field: "email" | "username",
    excludeId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const page = await this.userRepo.search(query, field, excludeId, cursor, limit);
    return { ...page, items: page.items.map(toUserResponse) };
  }

  async create(input: CreateUserInput): Promise<User> {
    const parsed = createUserSchema.safeParse(input);
    if (!parsed.success) {
      throw BusinessError.validation(parseSchemaIssues(parsed.error.issues));
    }
    const data = parsed.data;

    const [existingEmail, existingUsername] = await Promise.all([
      this.userRepo.findByEmail(data.email),
      this.userRepo.findByUsername(data.username),
    ]);
    if (existingEmail) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }
    if (existingUsername) {
      throw new BusinessError("USERNAME_TAKEN");
    }

    try {
      const created = await this.userRepo.create(data);
      this.logger.log("User created successfully", { userId: created.id, email: created.email });
      return created;
    } catch (err: unknown) {
      const mapped = mapUniqueViolation(err, [
        ["email", data.email],
        ["username", data.username],
      ]);
      if (mapped !== err) {
        throw mapped;
      }
      throw err;
    }
  }

  async getProfile(id: string): Promise<UserResponseDto> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    return toUserResponse(user);
  }

  async updateProfile(id: string, input: UpdateUserInput): Promise<UserResponseDto> {
    const parsed = updateUserSchema.safeParse(input);
    if (!parsed.success) {
      throw BusinessError.validation(parseSchemaIssues(parsed.error.issues));
    }

    const updated = await this.userRepo.updateProfile(id, parsed.data);
    if (!updated) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    this.logger.log("User profile updated", { userId: id });
    return toUserResponse(updated);
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    await this.userRepo.updatePasswordHash(id, hash);
    this.logger.log("User password hash updated", { userId: id });
  }

  async updateLastSeen(id: string, lastSeenAt?: Date): Promise<void> {
    await this.userRepo.updateLastSeen(id, lastSeenAt);
  }

  async softDelete(id: string): Promise<void> {
    await this.userRepo.softDelete(id);
    this.logger.log("User soft deleted", { userId: id });
  }
}
