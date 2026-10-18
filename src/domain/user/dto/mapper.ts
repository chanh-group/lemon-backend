import type { User } from "../schema.js";
import type { UserResponseDto } from "./response.js";

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
