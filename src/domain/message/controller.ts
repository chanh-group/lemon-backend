import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { created, ok, withMessage } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { MessageService } from "./service.js";
import {
  editMessageSchema,
  type EditMessageDto,
  sendMessageSchema,
  type SendMessageDto,
} from "./dto/request.js";

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post("conversations/:id/messages")
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Body({ schema: sendMessageSchema }) dto: SendMessageDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
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
    const parsedLimit = limit ? parseInt(limit, 10) : 30;
    const data = await this.messageService.getTimeline(
      userId,
      conversationId,
      cursor,
      parsedLimit,
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
