import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.js";
import { RedisIoAdapter } from "./configs/socket-adapter.js";
import { get_env } from "./helpers/index.js";
import { ErrorFilter } from "./middleware/error-filter.js";
import { createAppLogger } from "./utils/logger.js";
import { standardSchemaPipe } from "./utils/validation.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: createAppLogger(),
  });

  // Global REST API prefix: /api
  app.setGlobalPrefix("api");

  // Middlewares & Pipes
  app.use(cookieParser());
  app.useGlobalPipes(standardSchemaPipe());
  app.useGlobalFilters(new ErrorFilter());

  // CORS configuration
  const frontendUrl = get_env("FRONTEND_URL", "http://localhost:5173");
  const allowedOrigins = frontendUrl.includes(",")
    ? frontendUrl.split(",").map((s) => s.trim())
    : [frontendUrl, "http://localhost:5173", "http://localhost:3000"];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // WebSocket Redis IoAdapter for multi-node scaling
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = Number(get_env("PORT", "3000"));
  await app.listen(port);

  app.enableShutdownHooks();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await app.close();
      await redisIoAdapter.disconnect();
      process.exit(0);
    });
  }
}
await bootstrap();
