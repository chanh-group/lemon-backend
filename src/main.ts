import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createAppLogger } from './utils/logger.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: createAppLogger(),
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
