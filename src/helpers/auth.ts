import { createParamDecorator, ExecutionContext, HttpStatus } from "@nestjs/common";
import { AppHttpException } from "../utils/response.js";
import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

  // 1. Production Mode: From JWT Guard (req.user)
  if (req.user?.id) {
    return req.user.id;
  }

  // 2. Dev Mode: From header x-user-id
  const devUserId = req.headers["x-user-id"] as string | undefined;
  if (devUserId && typeof devUserId === "string" && devUserId.trim().length > 0) {
    return devUserId.trim();
  }

  throw new AppHttpException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Yêu cầu đăng nhập hoặc truyền header x-user-id");
});

