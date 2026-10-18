import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser } from "../domain/shared.js";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Decorator to mark an endpoint as publicly accessible,
 * bypassing the global AuthGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export type { AuthUser };

/**
 * Parameter decorator to extract the authenticated user
 * from the request object populated by AuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Chưa xác thực người dùng",
      });
    }
    return request.user;
  },
);
