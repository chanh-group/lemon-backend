import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Server, ServerOptions } from "socket.io";
import { get_env } from "../helpers/index.js";
import {
  DEFAULT_REDIS_URL,
  REDIS_RECONNECT_DELAY_BASE_MS,
  REDIS_RECONNECT_DELAY_MAX_MS,
} from "../utils/cache/constants.js";

const logger = new Logger("RedisIoAdapter");

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  async connectToRedis(): Promise<void> {
    const redisUrl = get_env("REDIS_URL", DEFAULT_REDIS_URL);

    let pubClient: Redis | null = null;
    let subClient: Redis | null = null;
    try {
      pubClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) =>
          Math.min(times * REDIS_RECONNECT_DELAY_BASE_MS, REDIS_RECONNECT_DELAY_MAX_MS),
      });
      subClient = pubClient.duplicate();

      pubClient.on("error", (err) => logger.warn(`Redis Pub client error: ${err.message}`));
      subClient.on("error", (err) => logger.warn(`Redis Sub client error: ${err.message}`));
      await Promise.all([pubClient.ping(), subClient.ping()]);

      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.pubClient = pubClient;
      this.subClient = subClient;
      logger.log("Socket.IO Redis Adapter connected successfully");
    } catch (err) {
      await Promise.all([this.quitQuietly(pubClient, "pub"), this.quitQuietly(subClient, "sub")]);
      throw new Error("Redis is required for the Socket.IO adapter", { cause: err });
    }
  }

  async disconnect(): Promise<void> {
    const pubClient = this.pubClient;
    const subClient = this.subClient;

    await Promise.all([this.quitQuietly(pubClient, "pub"), this.quitQuietly(subClient, "sub")]);

    this.pubClient = null;
    this.subClient = null;
  }

  private async quitQuietly(client: Redis | null, role: "pub" | "sub"): Promise<void> {
    if (!client) return;

    try {
      await client.quit();
    } catch (err) {
      logger.warn(`Redis ${role} client quit failed: ${String(err)}`);
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
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
    } as ServerOptions);

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
