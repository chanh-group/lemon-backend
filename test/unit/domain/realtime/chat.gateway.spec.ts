import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ChatGateway } from "../../../../src/domain/realtime/chat.gateway.js";
import type { JwtConfig } from "../../../../src/domain/auth/jwt.js";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import type { Redis } from "ioredis";
import type { Socket } from "socket.io";

describe("ChatGateway", () => {
  let gateway: ChatGateway;
  let verifyAccessTokenMock: Mock;
  let dbSelectMock: Mock;
  let dbUpdateMock: Mock;
  let updateSetMock: Mock;
  let updateWhereMock: Mock;
  let redisPipelineMock: Mock;
  let pipelineSetMock: Mock;
  let pipelineZaddMock: Mock;
  let pipelineZremMock: Mock;
  let redisTtlMock: Mock;
  let mockJwt: JwtConfig;
  let mockRedis: Redis;
  let mockDb: DrizzleDb;

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

    updateWhereMock = vi.fn().mockResolvedValue(undefined);
    updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    dbUpdateMock = vi.fn().mockReturnValue({ set: updateSetMock });

    pipelineSetMock = vi.fn().mockReturnThis();
    pipelineZaddMock = vi.fn().mockReturnThis();
    pipelineZremMock = vi.fn().mockReturnThis();
    redisPipelineMock = vi.fn().mockReturnValue({
      set: pipelineSetMock,
      zadd: pipelineZaddMock,
      zrem: pipelineZremMock,
      exec: vi.fn().mockResolvedValue([]),
    });

    redisTtlMock = vi.fn().mockResolvedValue(-2);
    mockRedis = {
      pipeline: redisPipelineMock,
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      ttl: redisTtlMock,
    } as unknown as Redis;

    mockDb = {
      select: dbSelectMock,
      update: dbUpdateMock,
    } as unknown as DrizzleDb;

    gateway = new ChatGateway(mockDb, mockJwt, mockRedis);
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
  }

  function createMockSocket(overrides: {
    auth?: Record<string, any>;
    headers?: Record<string, string>;
  }): MockSocketHandle {
    const joinMock = vi.fn().mockResolvedValue(undefined);
    const leaveMock = vi.fn().mockResolvedValue(undefined);
    const disconnectMock = vi.fn();
    const emitMock = vi.fn();
    const toMock = vi.fn().mockReturnValue({
      emit: vi.fn(),
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
    };
  }

  describe("handleConnection", () => {
    it("accepts connection with valid JWT in handshake.auth.token", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client, joinMock, disconnectMock } = createMockSocket({
        auth: { token: "valid-jwt" },
      });

      await gateway.handleConnection(client);

      expect(verifyAccessTokenMock).toHaveBeenCalledWith("valid-jwt");
      expect(joinMock).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(client.data.userId).toBe(mockUserId);
      expect(disconnectMock).not.toHaveBeenCalled();
    });

    it("joins all active conversation rooms on connect", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client, joinMock } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);

      expect(joinMock).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(joinMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
      expect(joinMock).toHaveBeenCalledWith(`conv:${mockConvId2}`);
    });

    it("accepts connection with valid JWT in Authorization header", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({
        headers: { authorization: "Bearer header-jwt" },
      });

      await gateway.handleConnection(client);

      expect(verifyAccessTokenMock).toHaveBeenCalledWith("header-jwt");
      expect(client.data.userId).toBe(mockUserId);
    });

    it("accepts connection with valid JWT in Cookie", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
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
    });
  });

  describe("presence", () => {
    it("stores online presence with the live connection count", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
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

    it("presence:ping refreshes online presence with the tracked connection count", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client: first } = createMockSocket({ auth: { token: "valid-jwt" } });
      const { client: second } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(first);
      await gateway.handleConnection(second);
      await gateway.handlePresencePing(first);

      expect(pipelineSetMock).toHaveBeenCalledTimes(3);
      const lastCall = pipelineSetMock.mock.calls[pipelineSetMock.mock.calls.length - 1];
      expect(JSON.parse(lastCall[1] as string)).toEqual({
        state: "online",
        lastSeen: expect.any(Number),
        conns: 2,
      });
    });

    it("skips marking offline when another node still heartbeats (ttl > 30)", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(60);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisTtlMock).toHaveBeenCalledWith(`presence:${mockUserId}`);
      expect(redisPipelineMock).toHaveBeenCalledTimes(1);
      expect(pipelineZremMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });

    it("marks offline when no other node heartbeats (ttl <= 30)", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(-1);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisPipelineMock).toHaveBeenCalledTimes(2);
      expect(pipelineZremMock).toHaveBeenCalledWith("presence:online", mockUserId);
      expect(dbUpdateMock).toHaveBeenCalled();
      expect(updateSetMock).toHaveBeenCalledWith({ lastSeenAt: expect.any(Date) });
      expect(updateWhereMock).toHaveBeenCalled();
    });

    it("reconnect within the grace period cancels the offline timer and refreshes presence", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
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
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);

      redisTtlMock.mockResolvedValue(-1);
      updateWhereMock.mockRejectedValue(new Error("db down"));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(dbUpdateMock).toHaveBeenCalled();
      expect(pipelineZremMock).toHaveBeenCalledWith("presence:online", mockUserId);
    });

    it("degrades safely in memory mode without a redis client", async () => {
      vi.useFakeTimers();
      const memoryGateway = new ChatGateway(mockDb, mockJwt, null);
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await memoryGateway.handleConnection(client);
      await memoryGateway.handleDisconnect(client);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisPipelineMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).toHaveBeenCalled();
    });
  });

  describe("onApplicationShutdown", () => {
    it("cancels grace timers so no offline presence or DB write happens after shutdown", async () => {
      vi.useFakeTimers();
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      await gateway.handleDisconnect(client);
      expect(vi.getTimerCount()).toBe(1);

      gateway.onApplicationShutdown();

      expect(vi.getTimerCount()).toBe(0);
      const internal = gateway as unknown as {
        graceTimers: Map<string, unknown>;
        userConnections: Map<string, number>;
      };
      expect(internal.graceTimers.size).toBe(0);
      expect(internal.userConnections.size).toBe(0);

      redisTtlMock.mockResolvedValue(-1);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(redisTtlMock).not.toHaveBeenCalled();
      expect(pipelineZremMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });

    it("clears tracked connections for users who are still online", async () => {
      verifyAccessTokenMock.mockResolvedValue({ sub: mockUserId });
      const { client } = createMockSocket({ auth: { token: "valid-jwt" } });

      await gateway.handleConnection(client);
      const internal = gateway as unknown as {
        userConnections: Map<string, number>;
      };
      expect(internal.userConnections.size).toBe(1);

      gateway.onApplicationShutdown();

      expect(internal.userConnections.size).toBe(0);
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
      // Mock db returning empty array (not a member)
      dbSelectMock.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

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
  });

  describe("typing:start and typing:stop", () => {
    it("broadcasts typing:start to room excluding sender", async () => {
      const { client, toMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      await gateway.handleTypingStart(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
    });

    it("broadcasts typing:stop to room excluding sender", async () => {
      const { client, toMock } = createMockSocket({});
      client.data = { userId: mockUserId };

      await gateway.handleTypingStop(client, { conversationId: mockConvId });

      expect(toMock).toHaveBeenCalledWith(`conv:${mockConvId}`);
    });
  });
});
