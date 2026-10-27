import { Inject, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { presenceOnlineKey, presenceUserKey, typingKey } from "../../utils/cache/keys.js";
import {
  OFFLINE_PRESENCE_TTL_SECONDS,
  PRESENCE_GRACE_MS,
  PRESENCE_OTHER_NODE_TTL_SECONDS,
  PRESENCE_TTL_SECONDS,
} from "../../utils/cache/constants.js";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { conversationParticipants } from "../conversation/schema.js";
import { users } from "../user/schema.js";
import { convRoom, userRoom } from "./rooms.js";
import { JWT_CONFIG } from "../auth/constants.js";
import type { JwtConfig } from "../auth/jwt.js";
import { get_env } from "../../helpers/index.js";

const logger = new Logger("ChatGateway");
const frontendUrl = get_env("FRONTEND_URL", "http://localhost:5173");
const allowedOrigins = frontendUrl.includes(",")
  ? frontendUrl.split(",").map((origin) => origin.trim())
  : [frontendUrl, "http://localhost:5173", "http://localhost:3000"];

export interface SocketUser {
  userId: string;
}

@WebSocketGateway({
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  server!: Server;

  // Track active connection counts per user: userId -> socket count
  private readonly userConnections = new Map<string, number>();
  // Track disconnect/offline recheck timers: userId -> timer
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDb,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    if (this.redis && typeof this.redis.on === "function") {
      const disconnectSockets = () => this.server?.disconnectSockets(true);
      for (const event of ["close", "end", "reconnecting", "error"]) {
        this.redis.on(event, disconnectSockets);
      }
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    if (this.redis && this.redis.status !== "ready") {
      client.disconnect(true);
      return;
    }

    const userId = await this.extractUserId(client);
    if (!userId) {
      logger.warn(`Unauthorized socket connection rejected: ${client.id}`);
      client.emit("error", {
        code: "UNAUTHORIZED",
        message: "Chưa xác thực người dùng",
      });
      client.disconnect(true);
      return;
    }

    client.data = { userId };
    await client.join(userRoom(userId));

    // Auto-join every conversation the user is an active participant of
    const convRows = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.leftAt)),
      );
    for (const row of convRows) {
      await client.join(convRoom(row.conversationId));
    }

    // Cancel grace period timer if reconnecting
    const existingTimer = this.graceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.graceTimers.delete(userId);
    }

    const currentConns = (this.userConnections.get(userId) ?? 0) + 1;
    this.userConnections.set(userId, currentConns);

    await this.setOnlinePresence(userId, currentConns);

    logger.log(
      `User connected: ${userId} (socket ${client.id}, active connections: ${currentConns})`,
    );
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;

    const currentConns = (this.userConnections.get(userId) ?? 1) - 1;
    if (currentConns <= 0) {
      this.userConnections.delete(userId);

      // Start grace period before marking offline; a reconnect within the window cancels it
      const existingTimer = this.graceTimers.get(userId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        await this.finalizeOffline(userId);
      }, PRESENCE_GRACE_MS);

      this.graceTimers.set(userId, timer);
    } else {
      this.userConnections.set(userId, currentConns);
    }

    logger.log(
      `User disconnected: ${userId} (socket ${client.id}, remaining: ${Math.max(0, currentConns)})`,
    );
  }

  onApplicationShutdown(): void {
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }

    this.graceTimers.clear();
    this.userConnections.clear();

    logger.log("ChatGateway shutdown: cleared presence grace timers and connection state");
  }

  @SubscribeMessage("conv:join")
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<{ success: boolean; conversationId: string } | void> {
    if (!data?.conversationId) return;
    const userId = client.data?.userId as string;
    if (!userId) return;

    // Verify user is an active participant in this conversation
    const [membership] = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, data.conversationId),
          eq(conversationParticipants.userId, userId),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .limit(1);

    if (!membership) {
      logger.warn(
        `Unauthorized conv:join attempt by user ${userId} for conversation ${data.conversationId}`,
      );
      client.emit("error", {
        code: "NOT_PARTICIPANT",
        message: "Bạn không phải thành viên của cuộc trò chuyện này",
      });
      return { success: false, conversationId: data.conversationId };
    }

    const room = convRoom(data.conversationId);
    await client.join(room);
    logger.debug(`Socket ${client.id} (user ${userId}) joined ${room}`);
    return { success: true, conversationId: data.conversationId };
  }

  @SubscribeMessage("conv:leave")
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<{ success: boolean; conversationId: string } | void> {
    if (!data?.conversationId) return;
    const room = convRoom(data.conversationId);
    await client.leave(room);
    logger.debug(`Socket ${client.id} left ${room}`);
    return { success: true, conversationId: data.conversationId };
  }

  @SubscribeMessage("typing:start")
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const userId = client.data?.userId as string;
    if (!userId || !data?.conversationId) return;

    const room = convRoom(data.conversationId);
    if (!client.rooms.has(room)) {
      return;
    }

    // Cache typing indicator in Redis with 3s TTL
    if (this.redis) {
      try {
        await this.redis.set(typingKey(data.conversationId, userId), "1", "EX", 3);
      } catch (err) {
        logger.warn(`Redis typing cache error: ${String(err)}`);
      }
    }

    // Broadcast to room excluding the sender
    client.to(room).emit("typing", {
      conversationId: data.conversationId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage("typing:stop")
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const userId = client.data?.userId as string;
    if (!userId || !data?.conversationId) return;

    const room = convRoom(data.conversationId);
    if (!client.rooms.has(room)) {
      return;
    }

    if (this.redis) {
      try {
        await this.redis.del(typingKey(data.conversationId, userId));
      } catch (err) {
        logger.warn(`Redis del typing error: ${String(err)}`);
      }
    }

    client.to(room).emit("typing", {
      conversationId: data.conversationId,
      userId,
      isTyping: false,
    });
  }

  @SubscribeMessage("presence:ping")
  async handlePresencePing(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = client.data?.userId as string;
    if (!userId) return;
    await this.setOnlinePresence(userId, this.userConnections.get(userId) ?? 1);
  }

  // --- Helper methods ---

  private async extractUserId(client: Socket): Promise<string | null> {
    const rawAuth = client.handshake.auth?.token as string | undefined;
    const rawHeader = client.handshake.headers?.authorization as string | undefined;
    const cookieHeader = client.handshake.headers?.cookie as string | undefined;

    let token: string | undefined;

    if (rawAuth && typeof rawAuth === "string") {
      token = rawAuth.trim();
    } else if (rawHeader && typeof rawHeader === "string" && rawHeader.startsWith("Bearer ")) {
      token = rawHeader.substring(7).trim();
    } else if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)lemon_access_token=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }

    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwt.verifyAccessToken(token);
      return payload.sub;
    } catch (err) {
      logger.warn(`Socket JWT verification failed: ${String(err)}`);
      return null;
    }
  }

  private async finalizeOffline(userId: string): Promise<void> {
    this.graceTimers.delete(userId);

    // Another node still heartbeats when the state key has a healthy remaining TTL —
    // leave the user online (the reconnect may also have refreshed presence meanwhile).
    if (this.redis) {
      try {
        const ttl = await this.redis.ttl(presenceUserKey(userId));
        if (ttl > PRESENCE_OTHER_NODE_TTL_SECONDS) {
          logger.log(
            `Presence offline deferred for ${userId}: another node may still heartbeat (ttl ${ttl}s)`,
          );
          const retryDelayMs = (ttl - PRESENCE_OTHER_NODE_TTL_SECONDS) * 1000 + 1000;
          const timer = setTimeout(() => {
            void this.finalizeOffline(userId);
          }, retryDelayMs);
          this.graceTimers.set(userId, timer);
          return;
        }
      } catch (err) {
        logger.warn(`Presence TTL check failed for ${userId}: ${String(err)}`);
      }
    }

    await Promise.all([this.setOfflinePresence(userId), this.touchLastSeen(userId)]);
    logger.log(`User marked offline after ${PRESENCE_GRACE_MS / 1000}s grace: ${userId}`);
  }

  private async touchLastSeen(userId: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(users.id, userId));
    } catch (err) {
      logger.warn(`Failed to touch lastSeen for ${userId}: ${String(err)}`);
    }
  }

  private async setOnlinePresence(userId: string, conns: number): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis
        .pipeline()
        .set(
          presenceUserKey(userId),
          JSON.stringify({ state: "online", lastSeen: now, conns }),
          "EX",
          PRESENCE_TTL_SECONDS,
        )
        .zadd(presenceOnlineKey(), now, userId)
        .exec();
    } catch (err) {
      logger.warn(`Failed to set online presence for ${userId}: ${String(err)}`);
    }
  }

  private async setOfflinePresence(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis
        .pipeline()
        .set(
          presenceUserKey(userId),
          JSON.stringify({ state: "offline", lastSeen: now }),
          "EX",
          OFFLINE_PRESENCE_TTL_SECONDS,
        )
        .zrem(presenceOnlineKey(), userId)
        .exec();
    } catch (err) {
      logger.warn(`Failed to set offline presence for ${userId}: ${String(err)}`);
    }
  }
}
