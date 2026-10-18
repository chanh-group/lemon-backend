import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ZodError } from "zod";
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

  async create(input: CreateUserInput): Promise<User> {
    const data = this.validate(createUserSchema, input);

    const existingEmail = await this.userRepo.findByEmail(data.email);
    if (existingEmail) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }

    const existingUsername = await this.userRepo.findByUsername(data.username);
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
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "Không tìm thấy user",
      });
    }
    return toUserResponse(user);
  }

  async updateProfile(id: string, input: UpdateUserInput): Promise<UserResponseDto> {
    const data = this.validate(updateUserSchema, input);

    const updated = await this.userRepo.updateProfile(id, data);
    if (!updated) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "Không tìm thấy user",
      });
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

  private validate<T>(schema: { parse: (val: unknown) => T }, input: unknown): T {
    try {
      return schema.parse(input);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        const message = firstIssue?.message ?? "Dữ liệu không hợp lệ";
        throw new UnprocessableEntityException({
          code: "VALIDATION_ERROR",
          message,
        });
      }
      throw err;
    }
  }
}
