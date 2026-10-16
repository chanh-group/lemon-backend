import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../helpers/auth.js";
import { created, ok, type SuccessResponse } from "../../utils/response.js";
import { MessageService, type SendMessageDto } from "./service.js";

export interface EditMessageDto {
  body: string;
}

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post("conversations/:id/messages")
  async sendMessage(
    @CurrentUser() userId: string,
    @Param("id") conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<SuccessResponse> {
    const message = await this.messageService.sendMessage(userId, conversationId, dto);
    return created(message, "OK");
  }

  @Get("conversations/:id/messages")
  async getMessages(
    @CurrentUser() userId: string,
    @Param("id") conversationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("after") after?: string,
  ): Promise<SuccessResponse> {
    const parsedLimit = limit ? parseInt(limit, 10) : 30;
    const result = await this.messageService.getTimeline(userId, conversationId, cursor, parsedLimit, after);
    return ok(result);
  }

  @Patch("messages/:id")
  async editMessage(
    @CurrentUser() userId: string,
    @Param("id") messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<SuccessResponse> {
    const updated = await this.messageService.editMessage(userId, messageId, dto.body);
    return ok(updated, "OK");
  }

  @Delete("messages/:id")
  async revokeMessage(
    @CurrentUser() userId: string,
    @Param("id") messageId: string,
  ): Promise<SuccessResponse> {
    const revoked = await this.messageService.revokeMessage(userId, messageId);
    return ok(revoked, "Đã thu hồi tin nhắn");
  }
}

