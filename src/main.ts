import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.js";
import { get_env } from "./helpers/index.js";
import { ErrorFilter } from "./middleware/error-filter.js";
import { createAppLogger } from "./utils/logger.js";
import { standardSchemaPipe } from "./utils/validation.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: createAppLogger(),
  });
  app.useGlobalPipes(standardSchemaPipe());
  app.useGlobalFilters(new ErrorFilter());
  await app.listen(Number(get_env("PORT", "3000")));
}
await bootstrap();
