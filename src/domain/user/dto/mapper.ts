import type { User } from "../schema.js";
import type { PublicUserResponse, UserResponseDto } from "./response.js";

export function toPublicUserResponse(user: User): PublicUserResponse {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
  };
}

export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    phone: user.phone ?? null,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    lastSeenAt: user.lastSeenAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
