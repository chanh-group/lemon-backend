import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { get_env } from "../helpers/index.js";

const logger = new Logger("RedisIoAdapter");

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  async connectToRedis(): Promise<void> {
    const redisUrl = get_env("REDIS_URL", "");
    if (!redisUrl || process.env.USE_MEMORY_CACHE === "true") {
      logger.log("Using in-memory adapter for Socket.IO");
      return;
    }

    try {
      const pubClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 100, 3000),
      });
      const subClient = pubClient.duplicate();

      pubClient.on("error", (err) => logger.warn(`Redis Pub client error: ${err.message}`));
      subClient.on("error", (err) => logger.warn(`Redis Sub client error: ${err.message}`));

      this.adapterConstructor = createAdapter(pubClient, subClient);
      logger.log("Socket.IO Redis Adapter connected successfully");
    } catch (err) {
      logger.warn(
        `Failed to initialize Redis Adapter: ${String(err)}. Falling back to in-memory adapter.`,
      );
    }
  }

  override createIOServer(port: number, options?: any): any {
    const frontendUrl = get_env("FRONTEND_URL", "http://localhost:5173");
    const allowedOrigins = frontendUrl.includes(",")
      ? frontendUrl.split(",").map((s) => s.trim())
      : [frontendUrl, "http://localhost:5173", "http://localhost:3000"];

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: allowedOrigins,
        credentials: true,
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
