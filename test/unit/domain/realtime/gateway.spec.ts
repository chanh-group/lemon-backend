import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ChatGateway } from "../../../../src/domain/realtime/gateway.js";
import {
  REDIS_DISCONNECT_GRACE_MS,
  TYPING_TTL_SECS,
} from "../../../../src/domain/realtime/constants.js";
import type { JwtConfig } from "../../../../src/domain/auth/jwt.js";
import type { Redis } from "ioredis";
import type { Server, Socket } from "socket.io";

describe("ChatGateway", () => {
  let gateway: ChatGateway;
  let verifyAccessTokenMock: Mock;
  let dbSelectMock: Mock;
  let dbUpdateMock: Mock;
  let updateSetMock: Mock;
  let updateWhereMock: Mock;
  let redisPipelineMock: Mock;
  let redisSetMock: Mock;
  let redisDelMock: Mock;
  let pipelineSetMock: Mock;
  let pipelineZaddMock: Mock;
  let pipelineZremMock: Mock;
  let pipelineExpireMock: Mock;
  let redisTtlMock: Mock;
  let mockJwt: JwtConfig;
  let mockRedis: Redis;
  let activeConversationIdsMock: Mock;
  let isParticipantMock: Mock;
  let getParticipantUserIdsMock: Mock;
  let updateLastSeenMock: Mock;
  let findAuthUserMock: Mock;
  let sessionActiveMock: Mock;
  let revocationTrackMock: Mock;

  const mockUserId = "0193a2b1-0000-7000-8000-000000000001";
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";
  const mockConvId2 = "0193a2b1-0000-7000-8000-000000000011";

  function makeDb(
    convRows: Array<{ conversationId: string }> = [
      { conversationId: mockConvId },
      { conversationId: mockConvId2 },
    ],
  ) {
    // handleConnection awaits the query directly; conv:join calls .limit(1).
    // A real Promise with an attached .limit serves both shapes.
    const whereResult = Object.assign(Promise.resolve(convRows), {
      limit: vi.fn().mockResolvedValue([{ conversationId: mockConvId }]),
    });

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(whereResult),
      }),
    };
  }

  beforeEach(() => {
    verifyAccessTokenMock = vi.fn();
    mockJwt = {
      verifyAccessToken: verifyAccessTokenMock,
    } as unknown as JwtConfig;

    dbSelectMock = vi.fn().mockImplementation(() => makeDb());
    activeConversationIdsMock = vi.fn().mockResolvedValue([mockConvId, mockConvId2]);
    isParticipantMock = vi.fn().mockResolvedValue(true);
    getParticipantUserIdsMock = vi.fn().mockResolvedValue([mockUserId, "other-user"]);
    updateLastSeenMock = vi.fn().mockResolvedValue(undefined);
    findAuthUserMock = vi.fn().mockResolvedValue({ authVersion: 0, isActive: true });
    sessionActiveMock = vi.fn().mockResolvedValue(true);
    revocationTrackMock = vi.fn().mockReturnValue(vi.fn());

    updateWhereMock = vi.fn().mockResolvedValue(undefined);
    updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    dbUpdateMock = vi.fn().mockReturnValue({ set: updateSetMock });

    pipelineSetMock = vi.fn().mockReturnThis();
    pipelineZaddMock = vi.fn().mockReturnThis();
    pipelineZremMock = vi.fn().mockReturnThis();
    pipelineExpireMock = vi.fn().mockReturnThis();
    redisPipelineMock = vi.fn().mockReturnValue({
      set: pipelineSetMock,
      zadd: pipelineZaddMock,
      zrem: pipelineZremMock,
      expire: pipelineExpireMock,
      exec: vi.fn().mockResolvedValue([]),
    });

    redisTtlMock = vi.fn().mockResolvedValue(-2);
    redisSetMock = vi.fn().mockResolvedValue("OK");
    redisDelMock = vi.fn().mockResolvedValue(1);
    mockRedis = {
      status: "ready",
      on: vi.fn(),
      pipeline: redisPipelineMock,
      set: redisSetMock,
      del: redisDelMock,
      ttl: redisTtlMock,
    } as unknown as Redis;

    gateway = new ChatGateway(
      {
        getActiveConversationIds: activeConversationIdsMock,
        isParticipant: isParticipantMock,
        getParticipantUserIds: getParticipantUserIdsMock,
      } as unknown as import("../../../../src/domain/conversation/pg.js").ConversationPgRepository,
      {
        updateLastSeen: updateLastSeenMock,
        findById: findAuthUserMock,
      } as unknown as import("../../../../src/domain/user/service.js").UserService,
      mockJwt,
      mockRedis,
      { isActive: sessionActiveMock } as never,
      { track: revocationTrackMock } as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  interface MockSocketHandle {
    client: Socket;
    joinMock: ReturnType<typeof vi.fn>;
    leaveMock: ReturnType<typeof vi.fn>;
    disconnectMock: ReturnType<typeof vi.fn>;
    emitMock: ReturnType<typeof vi.fn>;
    toMock: ReturnType<typeof vi.fn>;
    roomEmitMock: ReturnType<typeof vi.fn>;
  }

  function createMockSocket(overrides: {
    auth?: Record<string, any>;
    headers?: Record<string, string>;
  }): MockSocketHandle {
    const joinMock = vi.fn().mockResolvedValue(undefined);
    const leaveMock = vi.fn().mockResolvedValue(undefined);
    const disconnectMock = vi.fn();
    const emitMock = vi.fn();
    const roomEmitMock = vi.fn();
    const toMock = vi.fn().mockReturnValue({
      emit: roomEmitMock,
    });

    const client = {
      id: "socket-123",
      handshake: {
        auth: overrides.auth ?? {},
        headers: overrides.headers ?? {},
        query: {},
      },
      data: {},
      join: joinMock,
      leave: leaveMock,
      disconnect: disconnectMock,
      emit: emitMock,
      rooms: new Set([`conv:${mockConvId}`]),
      to: toMock,
    } as unknown as Socket;

    return {
      client,
      joinMock,
      leaveMock,
      disconnectMock,
      emitMock,
      toMock,
      roomEmitMock,
    };
  }

  function redisHandler(event: string): () => void {
    const entry = (mockRedis.on as unknown as Mock).mock.calls.find(([name]) => name === event);
    if (!entry) throw new Error(`no redis listener registered for "${event}"`);
    return entry[1] as () => void;
  }

  interface TrackedTimer {
    unref: Mock;
  }

  // Wraps the active setTimeout so each created timer's unref() call is spyable.
  function trackUnrefCalls(): { timers: TrackedTimer[]; restore: () => void } {
    const timers: TrackedTimer[] = [];
    const activeSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout");
    spy.mockImplementation(((handler: () => void, ms?: number) => {
      const handle = activeSetTimeout(handler, ms) as unknown as { unref?: () => unknown };
      const originalUnref = handle.unref?.bind(handle);
      const unrefMock: Mock = vi.fn(() => originalUnref?.());
      handle.unref = unrefMock as unknown as () => unknown;
      timers.push({ unref: unrefMock });
      return handle as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    return { timers, restore: () => spy.mockRestore() };
  }

  describe("handleConnection", () => {
    it("rejects sockets when the revocation listener is unavailable", async () => {
      verifyAccessTokenMock.mockResolvedValue({
        sub: mockUserId,
        authVersion: 0,
        sid: mockConvId,
        exp: Math.floor(Date.now() / 1000) + 900,
      });
      revocationTrackMock.mockReturnValue(null);
      const { client, disconnectMock, emitMock } = createMockSocket({
        auth: { token: "valid-jwt" },
      });
      await gateway.handleConnection(client);
      expect(emitMock).toHaveBeenCalledWith("error", { code: "UNAVAILABLE" });
      expect(disconnectMock).toHaveBeenCalledWith(true);
      expect(findAuthUserMock).not.toHaveBeenCalled();
    });
    it("rejects a socket when the password has changed since its token was issued", async () => {
      verifyAccessTokenMock.mockResolvedValue({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      });
      findAuthUserMock.mockResolvedValue({ authVersion: 1, isActive: true });
      const { client, disconnectMock, emitMock } = createMockSocket({
        auth: { token: "old-token" },
      });
      await gateway.handleConnection(client);
      expect(emitMock).toHaveBeenCalledWith("error", { code: "UNAUTHORIZED" });
      expect(disconnectMock).toHaveBeenCalledWith(true);
    });

    it("waits for authentication before processing an early room join", async () => {
      let finishAuthentication!: (value: { sub: string; authVersion: number; exp: number }) => void;
      verifyAccessTokenMock.mockReturnValue(
        new Promise((resolve) => {
          finishAuthentication = resolve;
        }),
      );
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      const connection = gateway.handleConnection(client);
      const join = gateway.handleJoinConversation(client, { conversationId: mockConvId });
      expect(isParticipantMock).not.toHaveBeenCalled();
      finishAuthentication({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      await connection;
      await expect(join).resolves.toEqual({ success: true, conversationId: mockConvId });
      await gateway.handleDisconnect(client);
      gateway.onApplicationShutdown();
    });

    it("disconnects the socket when its access token expires", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 10,
      });
      const { client, disconnectMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      await gateway.handleConnection(client);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(disconnectMock).toHaveBeenCalledWith(true);
      await gateway.handleDisconnect(client);
      gateway.onApplicationShutdown();
    });

    it("clears the expiration timer when the socket disconnects", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 10,
      });
      const { client, disconnectMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(disconnectMock).not.toHaveBeenCalled();
      gateway.onApplicationShutdown();
    });

    it("rejects connections while Redis is not ready", async () => {
      mockRedis.status = "reconnecting";
      const { client, disconnectMock } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);

      expect(disconnectMock).toHaveBeenCalledWith(true);
      expect(verifyAccessTokenMock).not.toHaveBeenCalled();
      expect(dbSelectMock).not.toHaveBeenCalled();
    });

    it("accepts connection with valid JWT in handshake.auth.token", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock, disconnectMock, emitMock } = createMockSocket({
        auth: { token: "valid-jwt" },
      });

      await gateway.handleConnection(client);

      expect(verifyAccessTokenMock).toHaveBeenCalledWith("valid-jwt");
      expect(joinMock).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(client.data.userId).toBe(mockUserId);
      expect(disconnectMock).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith("ready", { userId: mockUserId });
    });

    it("emits ready event only after joining the user room and active conversations", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock, emitMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      const callOrder: string[] = [];
      joinMock.mockImplementation(async (room: string | string[]) => {
        callOrder.push(`join:${Array.isArray(room) ? room.join(",") : room}`);
      });
      emitMock.mockImplementation((event: string) => {
        callOrder.push(`emit:${event}`);
      });

      await gateway.handleConnection(client);

      expect(callOrder).toEqual([
        `join:user:${mockUserId}`,
        `join:conv:${mockConvId},conv:${mockConvId2}`,
        "emit:ready",
      ]);
      expect(emitMock).toHaveBeenCalledWith("ready", { userId: mockUserId });
      await gateway.handleDisconnect(client);
      gateway.onApplicationShutdown();
    });

    it("does not emit ready event before user room join resolves", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock, emitMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      let finishJoin!: () => void;
      joinMock.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishJoin = resolve;
        }),
      );

      const connection = gateway.handleConnection(client);
      await vi.waitFor(() => {
        expect(joinMock).toHaveBeenCalledWith(`user:${mockUserId}`);
      });
      expect(emitMock).not.toHaveBeenCalledWith("ready", expect.anything());

      finishJoin();
      await connection;
      expect(emitMock).toHaveBeenCalledWith("ready", { userId: mockUserId });
      await gateway.handleDisconnect(client);
      gateway.onApplicationShutdown();
    });

    it("does not emit ready event if client disconnects before initialization completes", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock, emitMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      joinMock.mockImplementationOnce(async () => {
        Object.defineProperty(client, "disconnected", { value: true, configurable: true });
      });

      await gateway.handleConnection(client);
      expect(emitMock).not.toHaveBeenCalledWith("ready", expect.anything());
      gateway.onApplicationShutdown();
    });

    it("joins all active conversation rooms on connect", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);

      expect(joinMock).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(joinMock).toHaveBeenCalledWith([`conv:${mockConvId}`, `conv:${mockConvId2}`]);
    });

    it("fetches active conversation ids without waiting for the user room join", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client, joinMock } = createMockSocket({ auth: { token: "valid-jwt" } });
      let releaseJoin!: () => void;
      joinMock.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseJoin = resolve;
        }),
      );

      const connection = gateway.handleConnection(client);
      await vi.waitFor(() => {
        expect(activeConversationIdsMock).toHaveBeenCalledWith(mockUserId);
      });
      releaseJoin();
      await connection;
      await gateway.handleDisconnect(client);
      gateway.onApplicationShutdown();
    });

    it("accepts connection with valid JWT in Authorization header", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({
        headers: { authorization: "Bearer header-jwt" },
      });

      await gateway.handleConnection(client);

      expect(verifyAccessTokenMock).toHaveBeenCalledWith("header-jwt");
      expect(client.data.userId).toBe(mockUserId);
    });

    it("accepts connection with valid JWT in Cookie", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({
        headers: { cookie: "other=123; lemon_access_token=cookie-jwt; theme=dark" },
      });

      await gateway.handleConnection(client);

      expect(verifyAccessTokenMock).toHaveBeenCalledWith("cookie-jwt");
      expect(client.data.userId).toBe(mockUserId);
    });

    it("rejects connection immediately when token is missing", async () => {
      const { client, disconnectMock, emitMock } = createMockSocket({});

      await gateway.handleConnection(client);

      expect(disconnectMock).toHaveBeenCalledWith(true);
      expect(emitMock).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
      expect(emitMock).not.toHaveBeenCalledWith("ready", expect.anything());
    });

    it("rejects connection immediately when JWT verification fails", async () => {
      verifyAccessTokenMock.mockRejectedValue(new Error("Token expired"));
      const { client, disconnectMock, emitMock } = createMockSocket({
        auth: { token: "expired-jwt" },
      });

      await gateway.handleConnection(client);

      expect(disconnectMock).toHaveBeenCalledWith(true);
      expect(emitMock).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
      expect(emitMock).not.toHaveBeenCalledWith("ready", expect.anything());
    });
  });

  describe("presence", () => {
    it("stores online presence with the live connection count", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);

      expect(pipelineSetMock).toHaveBeenCalledTimes(1);
      const [key, payload, ex, ttl] = pipelineSetMock.mock.calls[0];
      expect(key).toBe(`presence:${mockUserId}`);
      expect(ex).toBe("EX");
      expect(ttl).toBe(90);
      expect(JSON.parse(payload as string)).toEqual({
        state: "online",
        lastSeen: expect.any(Number),
        conns: 1,
      });
      expect(pipelineZaddMock).toHaveBeenCalledWith(
        "presence:online",
        expect.any(Number),
        mockUserId,
      );
    });

    it("presence:ping rewrites the payload when the connection count changed", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client: first } = createMockSocket({ auth: { token: "valid-jwt" } });
      const { client: second } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(first);
      await gateway.handleConnection(second);
      await gateway.handleDisconnect(second);
      await gateway.handlePresencePing(first);

      expect(pipelineSetMock).toHaveBeenCalledTimes(3);
      const lastCall = pipelineSetMock.mock.calls[pipelineSetMock.mock.calls.length - 1];
      expect(JSON.parse(lastCall[1] as string)).toEqual({
        state: "online",
        lastSeen: expect.any(Number),
        conns: 1,
      });
    });

    it("presence:ping refreshes only liveness when state and connection count are unchanged", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handlePresencePing(client);

      // no re-serialization / re-SET of the presence JSON — only EXPIRE + ZADD
      expect(pipelineSetMock).toHaveBeenCalledTimes(1);
      expect(pipelineExpireMock).toHaveBeenCalledWith(`presence:${mockUserId}`, 90);
      expect(pipelineZaddMock).toHaveBeenCalledTimes(2);
      expect(pipelineZaddMock).toHaveBeenLastCalledWith(
        "presence:online",
        expect.any(Number),
        mockUserId,
      );
    });

    it("presence:ping rebuilds the state key when it expired since the last write", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      expect(pipelineSetMock).toHaveBeenCalledTimes(1);

      // EXPIRE on a vanished key returns 0 — the cheap refresh must fall back
      // to a full write that restores the presence JSON.
      redisPipelineMock.mockReturnValue({
        set: pipelineSetMock,
        zadd: pipelineZaddMock,
        zrem: pipelineZremMock,
        expire: pipelineExpireMock,
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 1],
        ]),
      });
      await gateway.handlePresencePing(client);

      expect(pipelineSetMock).toHaveBeenCalledTimes(2);
    });

    it("skips the redundant offline write when the user is already marked offline", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(-1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pipelineSetMock).toHaveBeenCalledTimes(2); // online + offline write

      const internal = gateway as unknown as {
        presence: { finalizeOffline(userId: string): Promise<void> };
      };
      await internal.presence.finalizeOffline(mockUserId);

      expect(pipelineSetMock).toHaveBeenCalledTimes(2); // offline state unchanged — skipped
    });

    it("rechecks offline presence after another node's heartbeat expires", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValueOnce(60).mockResolvedValueOnce(30);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisTtlMock).toHaveBeenCalledWith(`presence:${mockUserId}`);
      expect(redisPipelineMock).toHaveBeenCalledTimes(1);
      expect(pipelineZremMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(31_000);

      expect(redisTtlMock).toHaveBeenCalledTimes(2);
      expect(redisPipelineMock).toHaveBeenCalledTimes(2);
      expect(pipelineZremMock).toHaveBeenCalledWith("presence:online", mockUserId);
      expect(updateLastSeenMock).toHaveBeenCalledWith(mockUserId);
    });

    it("marks offline when no other node heartbeats (ttl <= 30)", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(-1);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisPipelineMock).toHaveBeenCalledTimes(2);
      expect(pipelineZremMock).toHaveBeenCalledWith("presence:online", mockUserId);
      expect(updateLastSeenMock).toHaveBeenCalledWith(mockUserId);
    });

    it("reconnect within the grace period cancels the offline timer and refreshes presence", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client: first } = createMockSocket({ auth: { token: "valid-jwt" } });
      const { client: second } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(first);
      await gateway.handleDisconnect(first);
      await vi.advanceTimersByTimeAsync(30_000);

      await gateway.handleConnection(second);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisPipelineMock).toHaveBeenCalledTimes(2);
      expect(pipelineZremMock).not.toHaveBeenCalled();
      const lastCall = pipelineSetMock.mock.calls[pipelineSetMock.mock.calls.length - 1];
      expect(JSON.parse(lastCall[1] as string)).toMatchObject({ state: "online", conns: 1 });
    });

    it("still marks offline after grace when the lastSeen DB write fails", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(-1);
      updateWhereMock.mockRejectedValue(new Error("db down"));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pipelineZremMock).toHaveBeenCalledWith("presence:online", mockUserId);
    });

    it("degrades safely in memory mode without a redis client", async () => {
      vi.useFakeTimers();
      const memoryGateway = new ChatGateway(
        {
          getActiveConversationIds: vi.fn().mockResolvedValue([]),
          isParticipant: vi.fn().mockResolvedValue(true),
        } as unknown as import("../../../../src/domain/conversation/pg.js").ConversationPgRepository,
        {
          updateLastSeen: vi.fn().mockResolvedValue(undefined),
          findById: findAuthUserMock,
        } as unknown as import("../../../../src/domain/user/service.js").UserService,
        mockJwt,
        null,
        { isActive: sessionActiveMock } as never,
        { track: vi.fn().mockReturnValue(vi.fn()) } as never,
      );
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await memoryGateway.handleConnection(client);
      await memoryGateway.handleDisconnect(client);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisPipelineMock).not.toHaveBeenCalled();
    });
  });

  describe("onApplicationShutdown", () => {
    it("cancels grace timers so no offline presence or DB write happens after shutdown", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);
      expect(vi.getTimerCount()).toBe(1);

      gateway.onApplicationShutdown();

      expect(vi.getTimerCount()).toBe(0);
      const internal = gateway as unknown as {
        presence: {
          graceTimers: Map<string, unknown>;
          userConnections: Map<string, number>;
          presenceWrites: Map<string, unknown>;
        };
      };
      expect(internal.presence.graceTimers.size).toBe(0);
      expect(internal.presence.userConnections.size).toBe(0);
      expect(internal.presence.presenceWrites.size).toBe(0);

      redisTtlMock.mockResolvedValue(-1);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisTtlMock).not.toHaveBeenCalled();
      expect(pipelineZremMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });

    it("clears tracked connections for users who are still online", async () => {
      verifyAccessTokenMock.mockImplementation(async () => ({
        sub: mockUserId,
        authVersion: 0,
        exp: Math.floor(Date.now() / 1000) + 900,
      }));
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      const internal = gateway as unknown as {
        presence: { userConnections: Map<string, number> };
      };
      expect(internal.presence.userConnections.size).toBe(1);

      gateway.onApplicationShutdown();

      expect(internal.presence.userConnections.size).toBe(0);
    });
  });

  describe("handleJoinConversation", () => {
    it("allows active participant to join conversation room", async () => {
      const { client, joinMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      const res = await gateway.handleJoinConversation(client, { conversationId: mockConvId });

      expect(joinMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
      expect(res).toEqual({ success: true, conversationId: mockConvId });
    });

    it("rejects non-participant with NOT_PARTICIPANT error", async () => {
      isParticipantMock.mockResolvedValueOnce(false);

      const { client, joinMock, emitMock } = createMockSocket({});
      client.data = { userId: "outsider-id" };

      const res = await gateway.handleJoinConversation(client, { conversationId: mockConvId });

      expect(joinMock).not.toHaveBeenCalledWith(`conv:${mockConvId}`);
      expect(emitMock).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ code: "NOT_PARTICIPANT" }),
      );
      expect(res).toEqual({ success: false, conversationId: mockConvId });
    });

    it("leaves the room when membership is revoked while join is pending", async () => {
      let finishJoin!: () => void;
      const joinPending = new Promise<void>((resolve) => {
        finishJoin = resolve;
      });
      const { client, joinMock, leaveMock, emitMock } = createMockSocket({});
      client.data = { userId: mockUserId };
      joinMock.mockImplementationOnce(() => joinPending);
      isParticipantMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = gateway.handleJoinConversation(client, { conversationId: mockConvId });
      await vi.waitFor(() => expect(joinMock).toHaveBeenCalledWith(`conv:${mockConvId}`));
      finishJoin();

      await expect(result).resolves.toEqual({ success: false, conversationId: mockConvId });
      expect(leaveMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
      expect(emitMock).toHaveBeenCalledWith("error", { code: "NOT_PARTICIPANT" });
    });
  });

  describe("typing:start and typing:stop", () => {
    it.each(["start", "stop"] as const)(
      "broadcasts %s once to active recipients only",
      async (event) => {
        getParticipantUserIdsMock.mockResolvedValue([mockUserId, "other-user", "third-user"]);
        const { client, toMock, roomEmitMock } = createMockSocket({});
        client.data = { userId: mockUserId };

        await (event === "start"
          ? gateway.handleTypingStart(client, { conversationId: mockConvId })
          : gateway.handleTypingStop(client, { conversationId: mockConvId }));

        expect(toMock).toHaveBeenCalledExactlyOnceWith(["user:other-user", "user:third-user"]);
        expect(roomEmitMock).toHaveBeenCalledOnce();
        expect(isParticipantMock).not.toHaveBeenCalled();
      },
    );

    it.each(["start", "stop"] as const)("rejects removed senders for %s", async (event) => {
      getParticipantUserIdsMock.mockResolvedValue(["other-user"]);
      const { client, toMock, leaveMock } = createMockSocket({});
      client.data = { userId: mockUserId };
      client.rooms.add(`conv:${mockConvId}`);

      await (event === "start"
        ? gateway.handleTypingStart(client, { conversationId: mockConvId })
        : gateway.handleTypingStop(client, { conversationId: mockConvId }));

      expect(leaveMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
      expect(toMock).not.toHaveBeenCalled();
      expect(redisSetMock).not.toHaveBeenCalled();
      expect(redisDelMock).not.toHaveBeenCalled();
    });

    it.each(["start", "stop"] as const)(
      "does not broadcast %s to an empty recipient set",
      async (event) => {
        getParticipantUserIdsMock.mockResolvedValue([mockUserId]);
        const { client, toMock } = createMockSocket({});
        client.data = { userId: mockUserId };

        await (event === "start"
          ? gateway.handleTypingStart(client, { conversationId: mockConvId })
          : gateway.handleTypingStop(client, { conversationId: mockConvId }));

        expect(toMock).not.toHaveBeenCalled();
      },
    );
    it("broadcasts typing:start to room excluding sender", async () => {
      const { client, toMock, roomEmitMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      await gateway.handleTypingStart(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(["user:other-user"]);
      expect(redisSetMock).toHaveBeenCalledWith(
        `typing:${mockConvId}:${mockUserId}`,
        "1",
        "EX",
        TYPING_TTL_SECS,
      );
      expect(roomEmitMock).toHaveBeenCalledWith("typing", {
        conversationId: mockConvId,
        userId: mockUserId,
        isTyping: true,
      });
    });

    it("broadcasts typing:stop to room excluding sender", async () => {
      const { client, toMock, roomEmitMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      await gateway.handleTypingStop(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(["user:other-user"]);
      expect(redisDelMock).toHaveBeenCalledWith(`typing:${mockConvId}:${mockUserId}`);
      expect(roomEmitMock).toHaveBeenCalledWith("typing", {
        conversationId: mockConvId,
        userId: mockUserId,
        isTyping: false,
      });
    });

    it("emits typing:start without waiting for the redis write", async () => {
      let releaseWrite!: () => void;
      redisSetMock.mockReturnValue(
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
      );
      const { client, toMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      // Resolves while the Redis write is still pending — the handler must not await it
      await gateway.handleTypingStart(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(["user:other-user"]);
      expect(redisSetMock).toHaveBeenCalledWith(
        `typing:${mockConvId}:${mockUserId}`,
        "1",
        "EX",
        TYPING_TTL_SECS,
      );
      releaseWrite();
    });

    it("emits typing:stop without waiting for the redis delete", async () => {
      let releaseDelete!: () => void;
      redisDelMock.mockReturnValue(
        new Promise<void>((resolve) => {
          releaseDelete = resolve;
        }),
      );
      const { client, toMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      await gateway.handleTypingStop(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(["user:other-user"]);
      expect(redisDelMock).toHaveBeenCalledWith(`typing:${mockConvId}:${mockUserId}`);
      releaseDelete();
    });

    it("still broadcasts typing when the redis writes fail", async () => {
      redisSetMock.mockRejectedValue(new Error("redis down"));
      redisDelMock.mockRejectedValue(new Error("redis down"));
      const { client: startClient, toMock: startTo } = createMockSocket({});
      startClient.data = { userId: mockUserId };
      const { client: stopClient, toMock: stopTo } = createMockSocket({});
      stopClient.data = { userId: mockUserId };

      await gateway.handleTypingStart(startClient, { conversationId: mockConvId });
      await gateway.handleTypingStop(stopClient, { conversationId: mockConvId });

      expect(startTo).toHaveBeenCalledWith(["user:other-user"]);
      expect(stopTo).toHaveBeenCalledWith(["user:other-user"]);
    });
  });

  describe("redis failure handling", () => {
    it("keeps sockets connected when redis recovers within the disconnect grace period", async () => {
      vi.useFakeTimers();
      const disconnectSocketsMock = vi.fn();
      gateway.server = { disconnectSockets: disconnectSocketsMock } as unknown as Server;

      redisHandler("error")();
      redisHandler("reconnecting")();
      redisHandler("ready")(); // recovered before the grace period elapsed

      await vi.advanceTimersByTimeAsync(REDIS_DISCONNECT_GRACE_MS * 2);

      expect(disconnectSocketsMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels a scheduled disconnect when redis recovers after a partial outage", async () => {
      vi.useFakeTimers();
      const disconnectSocketsMock = vi.fn();
      gateway.server = { disconnectSockets: disconnectSocketsMock } as unknown as Server;

      redisHandler("close")();
      await vi.advanceTimersByTimeAsync(REDIS_DISCONNECT_GRACE_MS / 2);
      redisHandler("connect")();

      await vi.advanceTimersByTimeAsync(REDIS_DISCONNECT_GRACE_MS * 2);

      expect(disconnectSocketsMock).not.toHaveBeenCalled();
    });

    it("disconnects every socket when the redis outage outlasts the grace period", async () => {
      vi.useFakeTimers();
      const disconnectSocketsMock = vi.fn();
      gateway.server = { disconnectSockets: disconnectSocketsMock } as unknown as Server;

      redisHandler("close")();
      redisHandler("error")(); // repeat failures must not stack timers
      redisHandler("reconnecting")();

      await vi.advanceTimersByTimeAsync(REDIS_DISCONNECT_GRACE_MS - 1);
      expect(disconnectSocketsMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(disconnectSocketsMock).toHaveBeenCalledTimes(1);
      expect(disconnectSocketsMock).toHaveBeenCalledWith(true);
    });
  });

  describe("timer ref hygiene", () => {
    it("unrefs presence timers so pending grace work cannot delay process exit", async () => {
      vi.useFakeTimers();
      const tracker = trackUnrefCalls();
      try {
        verifyAccessTokenMock.mockImplementation(async () => ({
          sub: mockUserId,
          authVersion: 0,
          exp: Math.floor(Date.now() / 1000) + 900,
        }));
        const { client } = createMockSocket({ auth: { token: "valid-jwt" } });
        await gateway.handleConnection(client);
        await gateway.handleDisconnect(client);
        redisTtlMock.mockResolvedValue(60); // another node heartbeats → offline recheck scheduled
        await vi.advanceTimersByTimeAsync(60_000);

        // expiry timer + presence grace timer + offline recheck timer
        expect(tracker.timers).toHaveLength(3);
        expect(tracker.timers.every((timer) => timer.unref.mock.calls.length > 0)).toBe(true);
      } finally {
        tracker.restore();
      }
    });

    it("unrefs the redis outage timer so it cannot delay process exit", async () => {
      vi.useFakeTimers();
      const tracker = trackUnrefCalls();
      try {
        gateway.server = { disconnectSockets: vi.fn() } as unknown as Server;
        redisHandler("error")();

        expect(tracker.timers).toHaveLength(1);
        expect(tracker.timers.every((timer) => timer.unref.mock.calls.length > 0)).toBe(true);
      } finally {
        tracker.restore();
      }
    });
  });
});
