import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  RATE_LIMITER,
  RATE_LIMIT_CALL_INITIATE_IP_MAX,
  RATE_LIMIT_CALL_INITIATE_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  assertMixedRateLimit,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { created, ok } from "../../utils/response.js";
import { getAuthUser, parseCursorPage, type AuthUser } from "../shared.js";
import { DEFAULT_CALL_PAGE_SIZE, MAX_CALL_PAGE_SIZE } from "./constants.js";
import {
  endCallSchema,
  initiateCallSchema,
  rejectCallSchema,
  type EndCallDto,
  type InitiateCallDto,
  type RejectCallDto,
} from "./dto/request.js";
import { CallService } from "./service.js";

@Controller("calls")
export class CallController {
  constructor(
    private readonly service: CallService,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async initiateCall(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Body({ schema: initiateCallSchema }) dto: InitiateCallDto,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await assertMixedRateLimit(
      this.rateLimiter,
      "initiate-call",
      userId,
      extractClientIp(req),
      RATE_LIMIT_CALL_INITIATE_USER_MAX,
      RATE_LIMIT_CALL_INITIATE_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    const data = await this.service.initiateCall(userId, dto);
    return created(data, "Call initiated");
  }

  @Get(":id/token")
  async getCallToken(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.getCallToken(userId, id);
    return ok(data);
  }

  @Get("active")
  async getActiveCall(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const call = await this.service.getActiveCall(userId);
    return ok({ call });
  }

  @Get(":id")
  async getCallById(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.getCallById(userId, id);
    return ok(data);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  async acceptCall(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.acceptCall(userId, id);
    return ok(data);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectCall(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: rejectCallSchema }) dto: RejectCallDto,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.rejectCall(userId, id, dto.reason);
    return ok(data);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelCall(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.cancelCall(userId, id);
    return ok(data);
  }

  @Post(":id/end")
  @HttpCode(HttpStatus.OK)
  async endCall(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: endCallSchema }) dto: EndCallDto,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.endCall(userId, id, dto.reason);
    return ok(data);
  }

  @Get()
  async listCalls(
    @Req() req: { user?: unknown },
    @Query("conversationId") conversationId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const page = parseCursorPage(cursor, limit, DEFAULT_CALL_PAGE_SIZE, MAX_CALL_PAGE_SIZE);
    const data = await this.service.listCalls(userId, {
      conversationId,
      limit: page.size,
      cursor: page.cursor,
    });
    return ok(data);
  }
}
