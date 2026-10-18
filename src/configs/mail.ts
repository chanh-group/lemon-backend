import { Global, Module } from "@nestjs/common";
import { from_env, MAIL_CONFIG } from "../utils/mail/config.js";
import { MailService } from "../utils/mail/service.js";

@Global()
@Module({
  providers: [
    {
      provide: MAIL_CONFIG,
      useFactory: from_env,
    },
    MailService,
  ],
  exports: [MailService, MAIL_CONFIG],
})
export class MailModule {}
