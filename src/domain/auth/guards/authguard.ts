import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../../../utils/decorators.js";
import { BusinessError } from "../../../utils/errors/business.js";
import { SystemError } from "../../../utils/errors/system.js";
import { USER_REPOSITORY, type UserRepository } from "../../user/repository.js";
import { JWT_CONFIG } from "../constants.js";
import type { JwtConfig } from "../jwt.js";
import type { AuthUser } from "../types.js";
import { AUTH_SESSION_REPOSITORY, type AuthSessionRepository } from "../repository.js";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    @Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (context.getType() !== "http") {
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

    let payload: Awaited<ReturnType<JwtConfig["verifyAccessToken"]>>;
    try {
      payload = await this.jwt.verifyAccessToken(token);
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
    let user: Awaited<ReturnType<UserRepository["findById"]>>;
    let active: boolean;
    try {
      [user, active] = await Promise.all([
        this.userRepo.findById(payload.sub),
        this.sessions.isActive(payload.sub, payload.sid),
      ]);
    } catch (err) {
      this.logger.error("Failed to check access token state", { err });
      throw new SystemError("database", "Access token state query failed", { cause: err });
    }
    if (!user || !user.isActive || !active || user.authVersion !== payload.authVersion) {
      throw new BusinessError("UNAUTHORIZED");
    }
    request.user = { id: payload.sub };
    return true;
  }
}
