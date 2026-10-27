import { z } from "zod";
import { BusinessError } from "../utils/errors/business.js";
import type { AuthUser } from "./auth/types.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./pagination.constants.js";

const uuidSchema = z.string().uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CursorPageInput {
  cursor?: string;
  size: number;
}

export function toCursorPage<T>(
  rows: T[],
  size: number,
  getCursor: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  return {
    items,
    ...(hasMore && items.length > 0 ? { nextCursor: getCursor(items[items.length - 1]!) } : {}),
    hasMore,
  };
}

export function parseCursorPage(
  cursor: string | undefined,
  size: string | undefined,
  defaultSize = DEFAULT_PAGE_SIZE,
  maxSize = MAX_PAGE_SIZE,
  options?: { allowOpaque?: boolean },
): CursorPageInput {
  if (cursor !== undefined) {
    const validUuid = isUuid(cursor);
    const isOpaque = options?.allowOpaque && /^[A-Za-z0-9_-]{10,128}$/.test(cursor);
    if (!validUuid && !isOpaque) {
      throw new BusinessError("BAD_REQUEST");
    }
  }
  if (size === undefined) return { cursor, size: defaultSize };
  if (!/^[1-9]\d*$/.test(size)) throw new BusinessError("BAD_REQUEST");
  const parsedSize = Number(size);
  if (!Number.isSafeInteger(parsedSize)) throw new BusinessError("BAD_REQUEST");
  return { cursor, size: Math.min(parsedSize, maxSize) };
}

/**
 * Auth identity contract (AUTH.md): the auth middleware — owned by another
 * team, never implemented in this repo — verifies the Bearer access token and
 * injects `req.user = { id: string }`. Handlers trust nothing else; request
 * headers are NEVER accepted as identity (client-spoofable). Missing or
 * malformed `req.user` fails closed with BusinessError(UNAUTHORIZED) → 401.
 */
export type { AuthUser } from "./auth/types.js";

export function getAuthUser(req: { user?: unknown }): AuthUser {
  const user = req.user as { id?: unknown } | undefined;
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    throw new BusinessError("UNAUTHORIZED");
  }
  return { id: user.id };
}
