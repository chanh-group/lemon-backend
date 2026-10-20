import { Module } from "@nestjs/common";
import { UserModule } from "../user/module.js";
import { RateLimitModule } from "../../middleware/ratelimit.module.js";
import { JWT_CONFIG } from "./constants.js";
import { AuthController } from "./controller.js";
import { AuthGuard } from "./guards/authguard.js";
import { JwtConfig } from "./jwt.js";
import { AuthService } from "./service.js";

@Module({
  imports: [UserModule, RateLimitModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    { provide: JWT_CONFIG, useFactory: () => JwtConfig.from_env() },
  ],
  exports: [AuthService, AuthGuard, JWT_CONFIG, RateLimitModule],
})
export class AuthModule {}
