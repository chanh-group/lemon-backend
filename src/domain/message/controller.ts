import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  RATE_LIMITER,
  RATE_LIMIT_MESSAGE_IP_MAX,
  RATE_LIMIT_MESSAGE_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  assertMixedRateLimit,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { BusinessError } from "../../utils/errors/business.js";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { created, ok, withMessage } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { parseCursorPage } from "../shared.js";
import { MessageService } from "./service.js";
import { DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE } from "../pagination.constants.js";
import {
  editMessageSchema,
  type EditMessageDto,
  sendMessageSchema,
  type SendMessageDto,
} from "./dto/request.js";

@Controller()
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post("conversations/:id/messages")
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Body({ schema: sendMessageSchema }) dto: SendMessageDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await assertMixedRateLimit(
      this.rateLimiter,
      "send-message",
      userId,
      extractClientIp(req),
      RATE_LIMIT_MESSAGE_USER_MAX,
      RATE_LIMIT_MESSAGE_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    const data = await this.messageService.sendMessage(userId, conversationId, dto);
    return created(data, t("MESSAGE_SENT", lang));
  }

  @Get("conversations/:id/messages")
  async getMessages(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("after") after?: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    if (cursor !== undefined && after !== undefined) throw new BusinessError("BAD_REQUEST");
    const page = parseCursorPage(
      cursor ?? after,
      limit,
      DEFAULT_MESSAGE_PAGE_SIZE,
      MAX_MESSAGE_PAGE_SIZE,
    );
    const data = await this.messageService.getTimeline(
      userId,
      conversationId,
      cursor ? page.cursor : undefined,
      page.size,
      after,
    );
    return ok(data);
  }

  @Patch("messages/:id")
  async editMessage(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) messageId: string,
    @Body({ schema: editMessageSchema }) dto: EditMessageDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.messageService.editMessage(userId, messageId, dto.body);
    return withMessage(data, t("MESSAGE_EDITED", lang));
  }

  @Delete("messages/:id")
  async revokeMessage(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) messageId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.messageService.revokeMessage(userId, messageId);
    return withMessage(data, t("MESSAGE_DELETED", lang));
  }
}
