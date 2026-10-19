import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { created, messageOnly, ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { friendRequestSchema } from "./dto/request.js";
import { FriendService } from "./service.js";

@Controller("friends")
export class FriendController {
  constructor(private readonly service: FriendService) {}

  @Post("requests")
  @HttpCode(HttpStatus.CREATED)
  async sendRequest(
    @Req() req: { user?: unknown },
    @Body({ schema: friendRequestSchema }) dto: { userId: string },
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.sendRequest(userId, dto.userId);
    return created(undefined, t("FRIEND_REQUEST_SENT", lang));
  }

  @Get("requests")
  async listRequests(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.listRequests(userId);
    return ok(data);
  }

  @Post("requests/:requestId/accept")
  @HttpCode(HttpStatus.OK)
  async acceptRequest(
    @Req() req: { user?: unknown },
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.acceptRequest(requestId, userId);
    return messageOnly(t("FRIEND_REQUEST_ACCEPTED", lang));
  }

  @Post("requests/:requestId/decline")
  @HttpCode(HttpStatus.OK)
  async declineRequest(
    @Req() req: { user?: unknown },
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.declineRequest(requestId, userId);
    return messageOnly(t("FRIEND_REQUEST_DECLINED", lang));
  }

  @Delete("requests/:requestId")
  @HttpCode(HttpStatus.OK)
  async cancelRequest(
    @Req() req: { user?: unknown },
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.cancelRequest(requestId, userId);
    return messageOnly(t("FRIEND_REQUEST_CANCELLED", lang));
  }

  @Get()
  async listFriends(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    return ok(await this.service.listFriends(userId));
  }

  @Delete(":friendId")
  @HttpCode(HttpStatus.OK)
  async removeFriend(
    @Req() req: { user?: unknown },
    @Param("friendId", ParseUUIDPipe) friendId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.removeFriend(userId, friendId);
    return messageOnly(t("FRIEND_REMOVED", lang));
  }

  @Post(":friendId/block")
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @Req() req: { user?: unknown },
    @Param("friendId", ParseUUIDPipe) friendId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.service.blockUser(userId, friendId);
    return messageOnly(t("USER_BLOCKED_CONFIRMATION", lang));
  }
}
