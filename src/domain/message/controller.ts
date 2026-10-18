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
} from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../utils/decorators.js";
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
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Body({ schema: sendMessageSchema }) dto: SendMessageDto,
  ) {
    const message = await this.messageService.sendMessage(user.id, conversationId, dto);
    return {
      success: true,
      message: "OK",
      data: message,
    };
  }

  @Get("conversations/:id/messages")
  async getMessages(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("after") after?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 30;
    const result = await this.messageService.getTimeline(
      user.id,
      conversationId,
      cursor,
      parsedLimit,
      after,
    );
    return {
      success: true,
      message: "OK",
      data: result,
    };
  }

  @Patch("messages/:id")
  async editMessage(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) messageId: string,
    @Body({ schema: editMessageSchema }) dto: EditMessageDto,
  ) {
    const updated = await this.messageService.editMessage(user.id, messageId, dto.body);
    return {
      success: true,
      message: "OK",
      data: updated,
    };
  }

  @Delete("messages/:id")
  async revokeMessage(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) messageId: string,
  ) {
    const revoked = await this.messageService.revokeMessage(user.id, messageId);
    return {
      success: true,
      message: "Đã thu hồi tin nhắn",
      data: revoked,
    };
  }
}
