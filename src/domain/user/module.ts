import { Global, Module } from "@nestjs/common";
import { UserPgRepository } from "./pg.js";
import { USER_REPOSITORY } from "./repository.js";
import { UserService } from "./service.js";
import { UserController } from "./controller.js";

@Global()
@Module({
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: USER_REPOSITORY,
      useClass: UserPgRepository,
    },
  ],
  exports: [UserService, USER_REPOSITORY],
})
export class UserModule {}
