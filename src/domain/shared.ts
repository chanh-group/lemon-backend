import { BusinessError } from "../utils/errors/business.js";

export interface Pageable {
  cursor?: string;
  size: number;
}

export interface Page<T> {
  content: T[];
  cursor?: string;
  size: number;
}

/**
 * Auth identity contract (AUTH.md): the auth middleware — owned by another
 * team, never implemented in this repo — verifies the Bearer access token and
 * injects `req.user = { id: string }`. Handlers trust nothing else; request
 * headers are NEVER accepted as identity (client-spoofable). Missing or
 * malformed `req.user` fails closed with BusinessError(UNAUTHORIZED) → 401.
 */
export interface AuthUser {
  id: string;
}

export function getAuthUser(req: { user?: unknown }): AuthUser {
  const user = req.user as { id?: unknown } | undefined;
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    throw new BusinessError("UNAUTHORIZED");
  }
  return { id: user.id };
}
