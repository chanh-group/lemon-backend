import { Logger } from "@nestjs/common";
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
import { Inject, Optional } from "@nestjs/common";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import type { Redis } from "ioredis";

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

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.extractUserId(client);
    if (!userId) {
      logger.warn(`Unauthorized socket connection rejected: ${client.id}`);
      client.disconnect(true);
      return;
    }

    client.data = { userId };
    const userRoom = `user:${userId}`;
    await client.join(userRoom);

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

    logger.log(`User connected: ${userId} (socket ${client.id}, active connections: ${currentConns})`);
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

    logger.log(`User disconnected: ${userId} (socket ${client.id}, remaining: ${Math.max(0, currentConns)})`);
  }

  @SubscribeMessage("conv:join")
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    if (!data?.conversationId) return;
    const room = `conv:${data.conversationId}`;
    await client.join(room);
    logger.debug(`Socket ${client.id} joined ${room}`);
  }

  @SubscribeMessage("conv:leave")
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    if (!data?.conversationId) return;
    const room = `conv:${data.conversationId}`;
    await client.leave(room);
    logger.debug(`Socket ${client.id} left ${room}`);
  }

  @SubscribeMessage("typing:start")
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const userId = client.data?.userId as string;
    if (!userId || !data?.conversationId) return;

    // Cache typing indicator in Redis with 3s TTL
    if (this.redis) {
      try {
        await this.redis.set(typingKey(data.conversationId, userId), "1", "EX", 3);
      } catch (err) {
        logger.warn(`Redis typing cache error: ${String(err)}`);
      }
    }

    // Broadcast to room excluding the sender
    client.to(`conv:${data.conversationId}`).emit("typing", {
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

    if (this.redis) {
      try {
        await this.redis.del(typingKey(data.conversationId, userId));
      } catch (err) {
        logger.warn(`Redis del typing error: ${String(err)}`);
      }
    }

    client.to(`conv:${data.conversationId}`).emit("typing", {
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

  private extractUserId(client: Socket): string | null {
    // 1. Production Mode: Verify JWT token if provided
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace("Bearer ", "");
    if (token) {
      // Sẵn sàng khi Role 2 cung cấp token
      // TODO: verifyJwt(token)
    }

    // 2. Dev Mode: Allow direct userId from auth handshake or query
    const directUserId = (client.handshake.auth?.userId || client.handshake.query?.userId) as string;
    if (directUserId && typeof directUserId === "string") {
      return directUserId.trim();
    }

    return null;
  }

  private async setOnlinePresence(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis.pipeline()
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
      await this.redis.pipeline()
        .set(presenceUserKey(userId), JSON.stringify({ state: "offline", lastSeen: now }), "EX", 86400 * 7)
        .zrem(presenceOnlineKey(), userId)
        .exec();
    } catch (err) {
      logger.warn(`Failed to set offline presence for ${userId}: ${String(err)}`);
    }
  }
}
