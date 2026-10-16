import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../helpers/auth.js";
import { created, ok, type SuccessResponse } from "../../utils/response.js";
import { ConversationService } from "./service.js";

export interface CreateDirectDto {
  targetUserId: string;
}

export interface MarkReadDto {
  lastReadMessageId: string;
}

@Controller("conversations")
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  @Post("direct")
  async createDirect(
    @CurrentUser() userId: string,
    @Body() dto: CreateDirectDto,
  ): Promise<SuccessResponse> {
    const result = await this.service.getOrCreateDirect(userId, dto.targetUserId);
    return created(result, "OK");
  }

  @Get()
  async listConversations(
    @CurrentUser() userId: string,
    @Query("limit") limit?: string,
  ): Promise<SuccessResponse> {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const list = await this.service.listConversations(userId, parsedLimit);
    return ok(list);
  }

  @Get(":id")
  async getConversation(
    @CurrentUser() userId: string,
    @Param("id") id: string,
  ): Promise<SuccessResponse> {
    const conv = await this.service.getById(id, userId);
    return ok(conv);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() userId: string,
    @Param("id") id: string,
    @Body() dto: MarkReadDto,
  ): Promise<SuccessResponse> {
    await this.service.markAsRead(id, userId, dto.lastReadMessageId);
    return ok(null, "OK");
  }
}
