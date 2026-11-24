import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { CallController } from "../../../../src/domain/call/controller.js";
import {
  RATE_LIMITER,
  RATE_LIMIT_CALL_INITIATE_IP_MAX,
  RATE_LIMIT_CALL_INITIATE_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
} from "../../../../src/middleware/ratelimit.js";
import { ErrorFilter } from "../../../../src/middleware/error-filter.js";
import { CallService } from "../../../../src/domain/call/service.js";
import type {
  AcceptCallResponse,
  CallResponse,
  InitiateCallResponse,
} from "../../../../src/domain/call/dto/response.js";
import type { CursorPage } from "../../../../src/domain/shared.js";
import type { Logger } from "../../../../src/utils/logger.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

describe("CallController", () => {
  let app: INestApplication;
  let server: App;

  let initiateCallMock: Mock;
  let getCallTokenMock: Mock;
  let getActiveCallMock: Mock;
  let getCallByIdMock: Mock;
  let acceptCallMock: Mock;
  let rejectCallMock: Mock;
  let cancelCallMock: Mock;
  let endCallMock: Mock;
  let listCallsMock: Mock;
  let checkMixedLimitMock: Mock;

  const mockUserId = "0193a2b1-0000-7000-8000-000000000001";
  const mockPartnerId = "0193a2b1-0000-7000-8000-000000000002";
  const mockCallId = "0193a2b1-0000-7000-8000-000000000020";
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";

  const mockLivekit = {
    serverUrl: "ws://localhost:7880",
    room: mockCallId,
    token: "mock-jwt-token",
  };

  const mockCallResponse: CallResponse = {
    id: mockCallId,
    conversationId: mockConvId,
    callerId: mockUserId,
    calleeId: mockPartnerId,
    media: "VIDEO",
    status: "INITIATED",
    startedAt: new Date("2026-11-20T10:00:00Z"),
    answeredAt: null,
    endedAt: null,
    endReason: null,
    durationSecs: 0,
  };

  beforeAll(async () => {
    initiateCallMock = vi.fn<() => Promise<InitiateCallResponse>>().mockResolvedValue({
      ...mockCallResponse,
      livekit: mockLivekit,
    });

    getCallTokenMock = vi.fn().mockResolvedValue(mockLivekit);
    getActiveCallMock = vi
      .fn<() => Promise<CallResponse | null>>()
      .mockResolvedValue(mockCallResponse);
    getCallByIdMock = vi.fn<() => Promise<CallResponse>>().mockResolvedValue(mockCallResponse);
    acceptCallMock = vi.fn<() => Promise<AcceptCallResponse>>().mockResolvedValue({
      ...mockCallResponse,
      status: "ACCEPTED",
      answeredAt: new Date(),
      livekit: mockLivekit,
    });
    rejectCallMock = vi.fn<() => Promise<CallResponse>>().mockResolvedValue({
      ...mockCallResponse,
      status: "REJECTED",
      endReason: "BUSY",
    });
    cancelCallMock = vi.fn<() => Promise<CallResponse>>().mockResolvedValue({
      ...mockCallResponse,
      status: "CANCELLED",
      endReason: "CANCELLED",
    });
    endCallMock = vi.fn<() => Promise<CallResponse>>().mockResolvedValue({
      ...mockCallResponse,
      status: "COMPLETED",
      durationSecs: 45,
    });
    listCallsMock = vi.fn<() => Promise<CursorPage<CallResponse>>>().mockResolvedValue({
      items: [mockCallResponse],
      hasMore: false,
    });
    checkMixedLimitMock = vi.fn().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      controllers: [CallController],
      providers: [
        {
          provide: RATE_LIMITER,
          useValue: { checkMixedLimit: checkMixedLimitMock },
        },
        {
          provide: CallService,
          useValue: {
            initiateCall: initiateCallMock,
            getCallToken: getCallTokenMock,
            getActiveCall: getActiveCallMock,
            getCallById: getCallByIdMock,
            acceptCall: acceptCallMock,
            rejectCall: rejectCallMock,
            cancelCall: cancelCallMock,
            endCall: endCallMock,
            listCalls: listCallsMock,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(standardSchemaPipe());
    app.useGlobalFilters(
      new ErrorFilter({ log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger),
    );
    app.use((req: Request, _res: Response, next: () => void) => {
      (req as unknown as { user: { id: string } }).user = { id: mockUserId };
      next();
    });
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /calls initiates a call", async () => {
    const res = await request(server)
      .post("/calls")
      .send({ conversationId: mockConvId, media: "VIDEO" })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(mockCallId);
    expect(initiateCallMock).toHaveBeenCalledWith(mockUserId, {
      conversationId: mockConvId,
      media: "VIDEO",
    });
    expect(checkMixedLimitMock).toHaveBeenCalledWith(
      "initiate-call",
      mockUserId,
      expect.any(String),
      RATE_LIMIT_CALL_INITIATE_USER_MAX,
      RATE_LIMIT_CALL_INITIATE_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
  });

  it("POST /calls rejects requests over the rate limit", async () => {
    checkMixedLimitMock.mockResolvedValueOnce(false);

    await request(server)
      .post("/calls")
      .send({ conversationId: mockConvId, media: "VIDEO" })
      .expect(429);

    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it("GET /calls/:id/token returns LiveKit access token", async () => {
    const res = await request(server).get(`/calls/${mockCallId}/token`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.serverUrl).toBe("ws://localhost:7880");
  });

  it("GET /calls/active returns currently active call", async () => {
    const res = await request(server).get("/calls/active").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.call.id).toBe(mockCallId);
  });

  it("GET /calls/:id returns call details", async () => {
    const res = await request(server).get(`/calls/${mockCallId}`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(mockCallId);
    expect(getCallByIdMock).toHaveBeenCalledWith(mockUserId, mockCallId);
  });

  it("POST /calls/:id/accept accepts a call", async () => {
    const res = await request(server).post(`/calls/${mockCallId}/accept`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ACCEPTED");
    expect(acceptCallMock).toHaveBeenCalledWith(mockUserId, mockCallId);
  });

  it("POST /calls/:id/reject rejects a call", async () => {
    const res = await request(server)
      .post(`/calls/${mockCallId}/reject`)
      .send({ reason: "BUSY" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("REJECTED");
    expect(rejectCallMock).toHaveBeenCalledWith(mockUserId, mockCallId, "BUSY");
  });

  it("POST /calls/:id/reject rejects unknown reasons", async () => {
    await request(server)
      .post(`/calls/${mockCallId}/reject`)
      .send({ reason: "not-an-enum-value" })
      .expect(422);

    expect(rejectCallMock).not.toHaveBeenCalled();
  });

  it("POST /calls/:id/cancel cancels a call", async () => {
    const res = await request(server).post(`/calls/${mockCallId}/cancel`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(cancelCallMock).toHaveBeenCalledWith(mockUserId, mockCallId);
  });

  it("POST /calls/:id/end ends an ongoing call", async () => {
    const res = await request(server)
      .post(`/calls/${mockCallId}/end`)
      .send({ reason: "NORMAL" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(endCallMock).toHaveBeenCalledWith(mockUserId, mockCallId, "NORMAL");
  });

  it("POST /calls/:id/end rejects unknown reasons", async () => {
    await request(server)
      .post(`/calls/${mockCallId}/end`)
      .send({ reason: "not-an-enum-value" })
      .expect(422);

    expect(endCallMock).not.toHaveBeenCalled();
  });

  it("GET /calls lists calls with pagination", async () => {
    const res = await request(server).get("/calls?limit=10").expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
    expect(listCallsMock).toHaveBeenCalledWith(mockUserId, {
      conversationId: undefined,
      limit: 10,
      cursor: undefined,
    });
  });
});
