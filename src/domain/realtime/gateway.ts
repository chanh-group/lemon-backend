// Socket.io gateway: decorators, lifecycle hooks and thin dispatchers.
// Concern logic lives in auth.ts (handshake auth), presence.ts (presence
// bookkeeping) and typing.ts (typing events); this is the only file that
// imports socket.io decorators.
import { Inject, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
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
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../utils/cache/store.js";
import { DEFAULT_FRONTEND_URL, DEFAULT_LOCALHOST_ORIGINS } from "../../configs/constants.js";
import { ConversationPgRepository } from "../conversation/pg.js";
import { UserService } from "../user/service.js";
import { convRoom, userRoom } from "./rooms.js";
import {
  CALL_DISCONNECT_HANDLER,
  type CallDisconnectHandler,
  REALTIME_EVENTS,
  REDIS_DISCONNECT_GRACE_MS,
  REDIS_LIFECYCLE_EVENTS,
  SOCKET_ERROR_CODES,
  SUBSCRIBE_EVENTS,
} from "./constants.js";
import { SocketAuthenticator } from "./auth.js";
import { PresenceTracker } from "./presence.js";
import { handleTypingEvent } from "./typing.js";
import type { SocketReadyEvent } from "./types.js";
import { JWT_CONFIG } from "../auth/constants.js";
import type { JwtConfig } from "../auth/jwt.js";
import { AUTH_SESSION_REPOSITORY, type AuthSessionRepository } from "../auth/repository.js";
import { AuthRevocationListener } from "../auth/pg.js";
import { get_env } from "../../helpers/index.js";

const logger = new Logger("ChatGateway");
const frontendUrl = get_env("FRONTEND_URL", DEFAULT_FRONTEND_URL);
const allowedOrigins = frontendUrl.includes(",")
  ? frontendUrl.split(",").map((origin) => origin.trim())
  : [frontendUrl, ...DEFAULT_LOCALHOST_ORIGINS];

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

  private readonly pendingConnections = new WeakMap<Socket, Promise<void>>();
  private readonly auth: SocketAuthenticator;
  private readonly presence: PresenceTracker;
  // Pending forced disconnect while a sustained Redis outage is being debounced
  private redisDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly conversationRepo: ConversationPgRepository,
    private readonly userService: UserService,
    @Inject(JWT_CONFIG) private readonly jwt: JwtConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
    private readonly revocations: AuthRevocationListener,
    private readonly moduleRef: ModuleRef,
  ) {
    this.auth = new SocketAuthenticator(this.jwt, this.revocations);
    this.presence = new PresenceTracker(this.userService, this.redis);
    if (this.redis && typeof this.redis.on === "function") {
      // Debounce failure events into a sustained-outage signal: a single
      // transient error must never force a reconnect wave across all sockets.
      const onRedisFailure = () => this.scheduleRedisDisconnect();
      for (const event of REDIS_LIFECYCLE_EVENTS.FAILURE) {
        this.redis.on(event, onRedisFailure);
      }
      const onRedisRecovery = () => this.cancelRedisDisconnect();
      for (const event of REDIS_LIFECYCLE_EVENTS.RECOVERY) {
        this.redis.on(event, onRedisRecovery);
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

    const payload = await this.auth.extractUserId(client);
    if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      logger.warn(`Unauthorized socket connection rejected: ${client.id}`);
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.UNAUTHORIZED });
      client.disconnect(true);
      return;
    }
    if (!this.auth.trackRevocation(client, payload)) {
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.UNAVAILABLE });
      client.disconnect(true);
      return;
    }
    let user: Awaited<ReturnType<UserService["findById"]>>;
    let active: boolean;
    try {
      [user, active] = await Promise.all([
        this.userService.findById(payload.sub),
        this.sessions.isActive(payload.sub, payload.sid),
      ]);
    } catch (err) {
      this.auth.untrack(client);
      logger.error("Socket authentication state query failed", { err });
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.UNAVAILABLE });
      client.disconnect(true);
      return;
    }
    if (!user || !user.isActive || !active || user.authVersion !== payload.authVersion) {
      this.auth.untrack(client);
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.UNAUTHORIZED });
      client.disconnect(true);
      return;
    }
    if (client.disconnected) {
      this.auth.untrack(client);
      return;
    }

    const userId = payload.sub;
    this.auth.armTokenExpiry(client, payload.exp * 1000);
    try {
      // The user room join and the conversation lookup are independent — batch them.
      const [, conversationIds] = await Promise.all([
        client.join(userRoom(userId)),
        this.conversationRepo.getActiveConversationIds(userId),
      ]);
      if (client.disconnected) {
        this.auth.untrack(client);
        return;
      }
      if (conversationIds.length > 0) {
        await client.join(conversationIds.map(convRoom));
        const activeAfterJoin = new Set(
          await this.conversationRepo.getActiveConversationIds(userId),
        );
        await Promise.all(
          conversationIds
            .filter((conversationId) => !activeAfterJoin.has(conversationId))
            .map((conversationId) => Promise.resolve(client.leave(convRoom(conversationId)))),
        );
      }
      if (client.disconnected) {
        this.auth.untrack(client);
        return;
      }
    } catch (err) {
      this.auth.untrack(client);
      client.disconnect(true);
      logger.warn("Socket initialization failed", { err });
      return;
    }

    client.data = { userId };

    const currentConns = await this.presence.registerConnection(userId);
    this.resolveCallHandler()
      ?.handleUserReconnect(userId)
      .catch(() => {});

    if (!client.disconnected) {
      client.emit(REALTIME_EVENTS.READY, { userId } satisfies SocketReadyEvent);
    }

    logger.log(
      `User connected: ${userId} (socket ${client.id}, active connections: ${currentConns})`,
    );
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.auth.untrack(client);
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;

    const currentConns = this.presence.registerDisconnection(userId);
    if (currentConns <= 0) {
      this.resolveCallHandler()
        ?.handleUserDisconnect(userId)
        .catch(() => {});
    }

    logger.log(
      `User disconnected: ${userId} (socket ${client.id}, remaining: ${Math.max(0, currentConns)})`,
    );
  }

  /**
   * Resolve the call session handler lazily instead of through constructor
   * injection: CallModule is a @Global module that imports RealtimeModule, so
   * the gateway is instantiated before CallModule's exports are resolvable and
   * an `@Optional()` constructor token silently stays undefined. `{ strict:
   * false }` searches the whole container, where the global provider lives.
   */
  private resolveCallHandler(): CallDisconnectHandler | undefined {
    try {
      return this.moduleRef.get<CallDisconnectHandler>(CALL_DISCONNECT_HANDLER, { strict: false });
    } catch {
      return undefined;
    }
  }

  onApplicationShutdown(): void {
    this.auth.shutdown();
    this.presence.shutdown();
    this.cancelRedisDisconnect();

    logger.log("ChatGateway shutdown: cleared presence grace timers and connection state");
  }

  /**
   * Debounce Redis failure events into a sustained-outage signal: sockets are
   * force-disconnected only once, after Redis has been failing for the whole
   * grace window. Recovery within the window cancels it (see
   * `cancelRedisDisconnect`), so a single transient error never drops sockets.
   */
  private scheduleRedisDisconnect(): void {
    if (this.redisDisconnectTimer) return;
    this.redisDisconnectTimer = setTimeout(() => {
      this.redisDisconnectTimer = null;
      logger.warn("Sustained Redis outage: force-disconnecting all sockets");
      this.server?.disconnectSockets(true);
    }, REDIS_DISCONNECT_GRACE_MS);
    this.redisDisconnectTimer.unref();
  }

  /** Redis recovered in time — cancel the pending forced disconnect. */
  private cancelRedisDisconnect(): void {
    if (!this.redisDisconnectTimer) return;
    clearTimeout(this.redisDisconnectTimer);
    this.redisDisconnectTimer = null;
  }

  @SubscribeMessage(SUBSCRIBE_EVENTS.CONV_JOIN)
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
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.NOT_PARTICIPANT });
      return { success: false, conversationId: data.conversationId };
    }

    const room = convRoom(data.conversationId);
    await client.join(room);
    if (!(await this.conversationRepo.isParticipant(data.conversationId, userId))) {
      await client.leave(room);
      client.emit(REALTIME_EVENTS.ERROR, { code: SOCKET_ERROR_CODES.NOT_PARTICIPANT });
      return { success: false, conversationId: data.conversationId };
    }
    logger.debug(`Socket ${client.id} (user ${userId}) joined ${room}`);
    return { success: true, conversationId: data.conversationId };
  }

  @SubscribeMessage(SUBSCRIBE_EVENTS.CONV_LEAVE)
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

  @SubscribeMessage(SUBSCRIBE_EVENTS.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await handleTypingEvent(
      client,
      data,
      {
        conversationRepo: this.conversationRepo,
        redis: this.redis,
        pending: this.pendingConnections.get(client),
      },
      true,
    );
  }

  @SubscribeMessage(SUBSCRIBE_EVENTS.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await handleTypingEvent(
      client,
      data,
      {
        conversationRepo: this.conversationRepo,
        redis: this.redis,
        pending: this.pendingConnections.get(client),
      },
      false,
    );
  }

  @SubscribeMessage(SUBSCRIBE_EVENTS.PRESENCE_PING)
  async handlePresencePing(@ConnectedSocket() client: Socket): Promise<void> {
    await this.pendingConnections.get(client);
    const userId = client.data?.userId as string;
    if (!userId) return;
    await this.presence.ping(userId);
  }
}
