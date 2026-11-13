import { Module } from "@nestjs/common";
import { UserModule } from "../user/module.js";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { JWT_CONFIG } from "./constants.js";
import { AuthController } from "./controller.js";
import { AuthGuard } from "./guards/authguard.js";
import { JwtConfig } from "./jwt.js";
import { AuthService } from "./service.js";
import { AUTH_SESSION_REPOSITORY } from "./repository.js";
import { AuthRevocationListener, AuthSessionPgRepository } from "./pg.js";

@Module({
  imports: [UserModule, RateLimitModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AuthRevocationListener,
    { provide: AUTH_SESSION_REPOSITORY, useClass: AuthSessionPgRepository },
    { provide: JWT_CONFIG, useFactory: () => JwtConfig.from_env() },
  ],
  exports: [
    AuthService,
    AuthGuard,
    JWT_CONFIG,
    RateLimitModule,
    AUTH_SESSION_REPOSITORY,
    AuthRevocationListener,
  ],
})
export class AuthModule {}
