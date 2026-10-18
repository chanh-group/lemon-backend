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
} from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../utils/decorators.js";
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
    @CurrentUser() user: AuthUser,
    @Body({ schema: createDirectSchema }) dto: CreateDirectDto,
  ) {
    const result = await this.service.getOrCreateDirect(user.id, dto.targetUserId);
    return {
      success: true,
      message: "OK",
      data: result,
    };
  }

  @Get()
  async listConversations(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const list = await this.service.listConversations(user.id, parsedLimit);
    return {
      success: true,
      message: "OK",
      data: list,
    };
  }

  @Get(":id")
  async getConversation(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const conv = await this.service.getById(id, user.id);
    return {
      success: true,
      message: "OK",
      data: conv,
    };
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: markReadSchema }) dto: MarkReadDto,
  ) {
    await this.service.markAsRead(id, user.id, dto.lastReadMessageId);
    return {
      success: true,
      message: "OK",
      data: null,
    };
  }
}
