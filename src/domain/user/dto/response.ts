/**
 * User-owned summary embedded in feed/viewer payloads across domains.
 * Field names are part of the cached-JSON shape — do not rename without
 * invalidating story/note feed caches.
 */
export interface UserSummary {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface UserResponseDto {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  emailVerifiedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
