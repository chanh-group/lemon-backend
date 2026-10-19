import { Global, Module } from "@nestjs/common";
import { UserPgRepository } from "./pg.js";
import { USER_REPOSITORY } from "./repository.js";
import { UserService } from "./service.js";

@Global()
@Module({
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
