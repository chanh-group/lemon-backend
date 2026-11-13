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
import { ConversationPgRepository } from "../conversation/pg.js";
import { UserService } from "../user/service.js";
import { convRoom, userRoom } from "./rooms.js";
import { JWT_CONFIG } from "../auth/constants.js";
import type { JwtConfig } from "../auth/jwt.js";
import type { AccessTokenPayload } from "../auth/types.js";
import { AUTH_SESSION_REPOSITORY, type AuthSessionRepository } from "../auth/repository.js";
import { AuthRevocationListener } from "../auth/pg.js";
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
  private readonly expiryTimers = new Map<Socket, ReturnType<typeof setTimeout>>();
  private readonly pendingConnections = new WeakMap<Socket, Promise<void>>();
  private readonly trackedSockets = new Map<Socket, () => void>();

  constructor(
    private readonly conversationRepo: ConversationPgRepository,
    private readonly userService: UserService,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
    private readonly revocations: AuthRevocationListener,
  ) {
    if (this.redis && typeof this.redis.on === "function") {
      const disconnectSockets = () => this.server?.disconnectSockets(true);
      for (const event of ["close", "end", "reconnecting", "error"]) {
        this.redis.on(event, disconnectSockets);
      }
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const pending = this.initializeConnection(client);
    this.pendingConnections.set(client, pending);
    await pending;
  }

  private async initializeConnection(client: Socket): Promise<void> {
    if (this.redis && this.redis.status !== "ready") {
      client.disconnect(true);
      return;
    }

    const payload = await this.extractUserId(client);
    if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      logger.warn(`Unauthorized socket connection rejected: ${client.id}`);
      client.emit("error", { code: "UNAUTHORIZED" });
      client.disconnect(true);
      return;
    }
    const untrack = this.revocations.track(payload.sub, payload.sid, () => client.disconnect(true));
    if (!untrack) {
      client.emit("error", { code: "UNAVAILABLE" });
      client.disconnect(true);
      return;
    }
    this.trackedSockets.set(client, untrack);
    let user: Awaited<ReturnType<UserService["findById"]>>;
    let active: boolean;
    try {
      [user, active] = await Promise.all([
        this.userService.findById(payload.sub),
        this.sessions.isActive(payload.sub, payload.sid),
      ]);
    } catch (err) {
      this.untrack(client);
      logger.error("Socket authentication state query failed", { err });
      client.emit("error", { code: "UNAVAILABLE" });
      client.disconnect(true);
      return;
    }
    if (!user || !user.isActive || !active || user.authVersion !== payload.authVersion) {
      this.untrack(client);
      client.emit("error", { code: "UNAUTHORIZED" });
      client.disconnect(true);
      return;
    }
    if (client.disconnected) {
      this.untrack(client);
      return;
    }

    const userId = payload.sub;
    const timer = setTimeout(() => client.disconnect(true), payload.exp * 1000 - Date.now());
    timer.unref();
    this.expiryTimers.set(client, timer);
    try {
      await client.join(userRoom(userId));

      // Auto-join every conversation the user is an active participant of
      const conversationIds = await this.conversationRepo.getActiveConversationIds(userId);
      if (client.disconnected) {
        this.untrack(client);
        return;
      }
      if (conversationIds.length > 0) await client.join(conversationIds.map(convRoom));
      if (client.disconnected) {
        this.untrack(client);
        return;
      }
    } catch (err) {
      this.untrack(client);
      clearTimeout(timer);
      this.expiryTimers.delete(client);
      client.disconnect(true);
      logger.warn("Socket initialization failed", { err });
      return;
    }

    client.data = { userId };

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
    this.untrack(client);
    const expiryTimer = this.expiryTimers.get(client);
    if (expiryTimer) clearTimeout(expiryTimer);
    this.expiryTimers.delete(client);
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
    for (const untrack of this.trackedSockets.values()) untrack();
    this.trackedSockets.clear();
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }

    this.graceTimers.clear();
    this.userConnections.clear();

    logger.log("ChatGateway shutdown: cleared presence grace timers and connection state");
  }

  private untrack(client: Socket): void {
    this.trackedSockets.get(client)?.();
    this.trackedSockets.delete(client);
    const timer = this.expiryTimers.get(client);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(client);
  }

  @SubscribeMessage("conv:join")
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<{ success: boolean; conversationId: string } | void> {
    await this.pendingConnections.get(client);
    if (!data?.conversationId) return;
    const userId = client.data?.userId as string;
    if (!userId) return;

    // Verify user is an active participant in this conversation
    if (!(await this.conversationRepo.isParticipant(data.conversationId, userId))) {
      logger.warn(
        `Unauthorized conv:join attempt by user ${userId} for conversation ${data.conversationId}`,
      );
      client.emit("error", { code: "NOT_PARTICIPANT" });
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
    await this.pendingConnections.get(client);
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
    await this.pendingConnections.get(client);
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
    await this.pendingConnections.get(client);
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
    await this.pendingConnections.get(client);
    const userId = client.data?.userId as string;
    if (!userId) return;
    await this.setOnlinePresence(userId, this.userConnections.get(userId) ?? 1);
  }

  // --- Helper methods ---

  private async extractUserId(client: Socket): Promise<AccessTokenPayload | null> {
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
        try {
          token = decodeURIComponent(match[1]);
        } catch {
          return null;
        }
      }
    }

    if (!token) {
      return null;
    }

    try {
      return await this.jwt.verifyAccessToken(token);
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
      await this.userService.updateLastSeen(userId);
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
