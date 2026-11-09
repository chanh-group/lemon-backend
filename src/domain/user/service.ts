import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  CreateUserInput,
  createUserSchema,
  UpdateUserInput,
  updateUserSchema,
} from "./dto/request.js";
import { toPublicUserResponse, toUserResponse } from "./dto/mapper.js";
import type { PublicUserResponse, UserResponseDto } from "./dto/response.js";
import { USER_PROFILE_CACHE_INVALIDATOR, USER_REPOSITORY } from "./repository.js";
import type { UserProfileCacheInvalidator, UserRepository } from "./repository.js";
import type { User } from "./schema.js";
import { BusinessError } from "../../utils/errors/business.js";
import { mapUniqueViolation } from "../../utils/errors/pg.js";
import { parseSchemaIssues } from "../../utils/validation.js";
import { USER_AVATAR_ALLOWED_MIME, USER_AVATAR_MAX_BYTES } from "../../utils/cache/constants.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import { avatarObjectKeyFromUrl } from "../../utils/storage/avatar.js";

function validateDataAvatar(dataUrl: string): void {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  const payload = match?.[2];
  if (!match || !payload || Buffer.from(payload, "base64").toString("base64") !== payload) {
    throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
  }
  const sizeBytes = Buffer.byteLength(payload, "base64");
  if (sizeBytes === 0) throw new BusinessError("BAD_REQUEST");
  if (sizeBytes > USER_AVATAR_MAX_BYTES) {
    throw new BusinessError("FILE_TOO_LARGE", { maxMb: "5" });
  }
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Optional()
    @Inject(USER_PROFILE_CACHE_INVALIDATOR)
    private readonly profileCacheInvalidator?: UserProfileCacheInvalidator,
    @Optional() @Inject(STORAGE_SERVICE) private readonly storage?: StorageService,
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
  ): Promise<{ items: PublicUserResponse[]; hasMore: boolean; nextCursor?: string }> {
    const page = await this.userRepo.search(query, field, excludeId, cursor, limit);
    return { ...page, items: page.items.map(toPublicUserResponse) };
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
      this.logger.log("User created successfully", { userId: created.id });
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

    const avatarUrl = parsed.data.avatarUrl;
    if (typeof avatarUrl === "string") {
      if (avatarUrl.startsWith("data:")) {
        validateDataAvatar(avatarUrl);
      } else {
        const objectKey = avatarObjectKeyFromUrl(avatarUrl, id);
        if (objectKey) {
          if (!this.storage) throw new BusinessError("OBJECT_NOT_UPLOADED");
          if (!objectKey.startsWith(`avatars/${id}/`))
            throw new BusinessError("INVALID_OBJECT_KEY");
          const object = await this.storage.headObject(objectKey);
          if (!object) throw new BusinessError("OBJECT_NOT_UPLOADED");
          if (object.contentLength > USER_AVATAR_MAX_BYTES) {
            throw new BusinessError("FILE_TOO_LARGE", { maxMb: "5" });
          }
          if (
            object.contentLength < 1 ||
            !(USER_AVATAR_ALLOWED_MIME as readonly string[]).includes(object.contentType)
          ) {
            throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
          }
        }
      }
    }

    const updated = await this.userRepo.updateProfile(id, parsed.data);
    if (!updated) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    if (parsed.data.fullName !== undefined || parsed.data.avatarUrl !== undefined) {
      await this.profileCacheInvalidator?.invalidateProfileFeeds(id);
    }

    // shortcut: replaced avatar objects stay in storage; add a DB-backed cleanup queue before deleting to avoid races with concurrent profile updates.
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
