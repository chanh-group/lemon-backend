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
