import { Global, Module } from "@nestjs/common";
import { UserPgRepository } from "./pg.js";
import { USER_REPOSITORY } from "./repository.js";

@Global()
@Module({
  providers: [
    {
      provide: USER_REPOSITORY,
      useClass: UserPgRepository,
    },
  ],
  exports: [USER_REPOSITORY],
})
export class UserModule {}

