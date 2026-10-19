import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ChatGateway } from "../../../../src/domain/realtime/chat.gateway.js";
import type { JwtConfig } from "../../../../src/domain/auth/jwt.js";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import type { Redis } from "ioredis";
import type { Socket } from "socket.io";

describe("ChatGateway", () => {
  let gateway: ChatGateway;
  let verifyAccessTokenMock: Mock;
  let dbSelectMock: Mock;
  let redisPipelineMock: Mock;

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
    const mockJwt = {
      verifyAccessToken: verifyAccessTokenMock,
    } as unknown as JwtConfig;

    dbSelectMock = vi.fn().mockImplementation(() => makeDb());

    redisPipelineMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    });

    const mockRedis = {
      pipeline: redisPipelineMock,
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const mockDb = {
      select: dbSelectMock,
    } as unknown as DrizzleDb;

    gateway = new ChatGateway(mockDb, mockJwt, mockRedis);
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
