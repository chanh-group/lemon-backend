import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import * as jose from "jose";
import { get_env } from "../../../helpers/index.js";
import { IS_PUBLIC_KEY, type AuthUser } from "../../../utils/decorators.js";
import { BusinessError } from "../../../utils/errors/business.js";
import {
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ISSUER,
  JWT_ALGORITHM,
  JWT_LEEWAY_SECS,
} from "../constants.js";
import type { AccessTokenPayload } from "../types.js";

export { CurrentUser, Public, type AuthUser } from "../../../utils/decorators.js";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly secretKey: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly reflector: Reflector) {
    const secret = get_env("JWT_SECRET");
    if (secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long");
    }
    this.secretKey = new TextEncoder().encode(secret);
    this.issuer = get_env("JWT_ISSUER", DEFAULT_JWT_ISSUER);
    this.audience = get_env("JWT_AUDIENCE", DEFAULT_JWT_AUDIENCE);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new BusinessError("UNAUTHORIZED");
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new BusinessError("UNAUTHORIZED");
    }

    try {
      const { payload } = await jose.jwtVerify<AccessTokenPayload>(token, this.secretKey, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: JWT_LEEWAY_SECS,
      });

      if (payload.type !== "access" || !payload.sub) {
        throw new BusinessError("UNAUTHORIZED");
      }

      request.user = { id: payload.sub };
      return true;
    } catch (err: unknown) {
      if (err instanceof BusinessError) {
        throw err;
      }
      this.logger.warn("Access token verification failed", {
        action: "auth.verify_failed",
        err: String(err),
      });
      throw new BusinessError("UNAUTHORIZED");
    }
  }
}
