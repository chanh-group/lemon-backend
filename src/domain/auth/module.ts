import { Module } from "@nestjs/common";
import { UserModule } from "../user/module.js";
import { AuthController } from "./controller.js";
import { AuthGuard } from "./guards/authguard.js";
import { AuthService } from "./service.js";

@Module({
  imports: [UserModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
