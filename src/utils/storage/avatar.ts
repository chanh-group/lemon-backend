import { get_env } from "../../helpers/index.js";
import { StorageError } from "./error.js";

const AVATAR_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i;

export function isAvatarFileName(value: string): boolean {
  return AVATAR_FILE_NAME.test(value);
}

function publicApiOrigin(): string | null {
  const isProduction =
    get_env("APP_ENV", "") === "production" || get_env("NODE_ENV", "") === "production";
  const value = get_env("API_PUBLIC_URL", isProduction ? "" : "http://localhost:3000");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("API_PUBLIC_URL must be an HTTPS origin");
    }
    return url.origin;
  } catch (err) {
    throw new StorageError("API_PUBLIC_URL must be a valid HTTPS origin", err);
  }
}

export function avatarUrlForObjectKey(userId: string, objectKey: string): string {
  const prefix = `avatars/${userId}/`;
  const fileName = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : "";
  const origin = publicApiOrigin();
  if (!origin || !isAvatarFileName(fileName)) {
    throw new StorageError("Avatar URL configuration or object key is invalid");
  }
  return `${origin}/api/files/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(fileName)}`;
}

export function avatarObjectKeyFromUrl(url: string, userId: string): string | null {
  const origin = publicApiOrigin();
  if (!origin) return null;
  try {
    const parsed = new URL(url);
    const prefix = `/api/files/avatars/${encodeURIComponent(userId)}/`;
    if (
      parsed.origin !== origin ||
      !parsed.pathname.startsWith(prefix) ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const fileName = decodeURIComponent(parsed.pathname.slice(prefix.length));
    if (!isAvatarFileName(fileName)) return null;
    return `avatars/${userId}/${fileName}`;
  } catch {
    return null;
  }
}
