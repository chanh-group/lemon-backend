import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import compression from "compression";
import { AppModule } from "./app.js";
import { RedisIoAdapter } from "./configs/socket-adapter.js";
import { DEFAULT_FRONTEND_URL, DEFAULT_LOCALHOST_ORIGINS } from "./configs/constants.js";
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
  app.getHttpAdapter().getInstance().set("trust proxy", get_env("TRUST_PROXY", "loopback"));

  // Middlewares & Pipes
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalPipes(standardSchemaPipe());
  app.useGlobalFilters(new ErrorFilter());

  // CORS configuration
  const frontendUrl = get_env("FRONTEND_URL", DEFAULT_FRONTEND_URL);
  const allowedOrigins = frontendUrl.includes(",")
    ? frontendUrl.split(",").map((s) => s.trim())
    : [frontendUrl, ...DEFAULT_LOCALHOST_ORIGINS];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // WebSocket Redis IoAdapter for multi-node scaling
  const redisIoAdapter = new RedisIoAdapter(app);
  try {
    await redisIoAdapter.connectToRedis();
  } catch (err) {
    await app.close();
    throw err;
  }
  app.useWebSocketAdapter(redisIoAdapter);

  const port = Number(get_env("PORT", "3000"));
  const host = get_env("HOST", "0.0.0.0");
  await app.listen(port, host);

  app.enableShutdownHooks();

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await app.close();
      await redisIoAdapter.disconnect();
      process.exit(0);
    });
  }
}
await bootstrap();
