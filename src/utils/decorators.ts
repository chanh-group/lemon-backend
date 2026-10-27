import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import { BusinessError } from "./errors/business.js";
import { getLanguageFromHeader } from "./i18n/index.js";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Decorator to mark an endpoint as publicly accessible,
 * bypassing the global AuthGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Parameter decorator to extract the authenticated user
 * from the request object populated by AuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string } => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    if (!request.user) {
      throw new BusinessError("UNAUTHORIZED");
    }
    return request.user;
  },
);

export const langParamFactory = (_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return getLanguageFromHeader(request.headers["accept-language"]);
};

export const Lang = createParamDecorator(langParamFactory);
