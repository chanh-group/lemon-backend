import { Inject, Logger, Optional } from "@nestjs/common";
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
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDb } from "../../configs/database.js";
import { conversationParticipants } from "../conversation/schema.js";
import { JWT_CONFIG } from "../auth/constants.js";
import type { JwtConfig } from "../auth/jwt.js";

const logger = new Logger("ChatGateway");

export interface SocketUser {
  userId: string;
}

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Track active connection counts per user: userId -> socket count
  private readonly userConnections = new Map<string, number>();
  // Track disconnect timers for 60s grace period: userId -> timer
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDb,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
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
    const userRoom = `user:${userId}`;
    await client.join(userRoom);

    // Auto-join every conversation the user is an active participant of
    const convRows = await this.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(eq(conversationParticipants.userId, userId), isNull(conversationParticipants.leftAt)),
      );
    for (const row of convRows) {
      await client.join(`conv:${row.conversationId}`);
    }

    // Cancel grace period timer if reconnecting
    const existingTimer = this.graceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.graceTimers.delete(userId);
    }

    const currentConns = (this.userConnections.get(userId) ?? 0) + 1;
    this.userConnections.set(userId, currentConns);

    // Update Redis presence (TTL 90s)
    await this.setOnlinePresence(userId);

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

      // Start 60-second grace period before marking offline
      const timer = setTimeout(async () => {
        await this.setOfflinePresence(userId);
        this.graceTimers.delete(userId);
        logger.log(`User marked offline after 60s grace: ${userId}`);
      }, 60000);

      this.graceTimers.set(userId, timer);
    } else {
      this.userConnections.set(userId, currentConns);
    }

    logger.log(
      `User disconnected: ${userId} (socket ${client.id}, remaining: ${Math.max(0, currentConns)})`,
    );
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

    const room = `conv:${data.conversationId}`;
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
    const room = `conv:${data.conversationId}`;
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

    const room = `conv:${data.conversationId}`;
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

    const room = `conv:${data.conversationId}`;
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
    await this.setOnlinePresence(userId);
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

  private async setOnlinePresence(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis
        .pipeline()
        .set(presenceUserKey(userId), JSON.stringify({ state: "online", lastSeen: now }), "EX", 90)
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
          86400 * 7,
        )
        .zrem(presenceOnlineKey(), userId)
        .exec();
    } catch (err) {
      logger.warn(`Failed to set offline presence for ${userId}: ${String(err)}`);
    }
  }
}
