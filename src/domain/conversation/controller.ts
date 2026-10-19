import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { created, messageOnly, ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { ConversationService } from "./service.js";
import {
  createDirectSchema,
  type CreateDirectDto,
  markReadSchema,
  type MarkReadDto,
} from "./dto/request.js";

@Controller("conversations")
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  @Post("direct")
  @HttpCode(HttpStatus.CREATED)
  async createDirect(
    @Req() req: { user?: unknown },
    @Body({ schema: createDirectSchema }) dto: CreateDirectDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.getOrCreateDirect(userId, dto.targetUserId);
    return created(data, t("CONVERSATION_READY", lang));
  }

  @Get()
  async listConversations(@Req() req: { user?: unknown }, @Query("limit") limit?: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const data = await this.service.listConversations(userId, parsedLimit);
    return ok(data);
  }

  @Get(":id")
  async getConversation(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.getById(id, userId);
    return ok(data);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: markReadSchema }) dto: MarkReadDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.markAsRead(id, userId, dto.lastReadMessageId);
    return messageOnly(t("MESSAGES_READ", lang));
  }
}
