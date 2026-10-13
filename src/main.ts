import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.js";
import { get_env } from "./helpers/index.js";
import { createAppLogger } from "./utils/logger.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: createAppLogger(),
  });
  await app.listen(Number(get_env("PORT", "3000")));
}
await bootstrap();
