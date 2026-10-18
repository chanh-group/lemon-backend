import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY, type AuthUser } from "../../../utils/decorators.js";
import { BusinessError } from "../../../utils/errors/business.js";
import { JWT_CONFIG } from "../constants.js";
import type { JwtConfig } from "../jwt.js";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
  ) {}

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
      const payload = await this.jwt.verifyAccessToken(token);

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
