import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Delete,
  Query,
  Req,
} from "@nestjs/common";
import { Lang } from "../../utils/decorators.js";
import { BusinessError } from "../../utils/errors/business.js";
import { t } from "../../utils/i18n/index.js";
import { created, messageOnly, ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { parseCursorPage } from "../shared.js";
import { ConversationService } from "./service.js";
import { DEFAULT_CONVERSATION_PAGE_SIZE, MAX_CONVERSATION_PAGE_SIZE } from "./constants.js";
import {
  createDirectSchema,
  type CreateDirectDto,
  createGroupSchema,
  type CreateGroupDto,
  addGroupMembersSchema,
  type AddGroupMembersDto,
  updateGroupSchema,
  type UpdateGroupDto,
  updateMemberRoleSchema,
  type UpdateMemberRoleDto,
  transferOwnershipSchema,
  type TransferOwnershipDto,
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

  @Post("groups")
  @HttpCode(HttpStatus.CREATED)
  async createGroup(
    @Req() req: { user?: unknown },
    @Body({ schema: createGroupSchema }) dto: CreateGroupDto,
    @Lang() lang: string,
  ) {
    const { id } = getAuthUser(req);
    return created(await this.service.createGroup(id, dto), t("CONVERSATION_READY", lang));
  }

  @Get()
  async listConversations(
    @Req() req: { user?: unknown },
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const page = parseCursorPage(
      cursor,
      limit,
      DEFAULT_CONVERSATION_PAGE_SIZE,
      MAX_CONVERSATION_PAGE_SIZE,
    );
    const data = await this.service.listConversations(userId, page.size, page.cursor);
    return ok(data);
  }

  @Get(":id")
  async getConversation(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.service.getById(id, userId);
    return ok(data);
  }

  @Get(":id/members")
  async listMembers(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    return ok(await this.service.listGroupMembers(id, getAuthUser(req).id));
  }

  @Patch(":id")
  async updateGroup(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: updateGroupSchema }) dto: UpdateGroupDto,
  ) {
    if (!dto.title) throw new BusinessError("BAD_REQUEST");
    await this.service.updateGroupTitle(id, getAuthUser(req).id, dto.title);
    return ok(await this.service.getById(id, getAuthUser(req).id));
  }

  @Post(":id/members")
  async addMembers(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: addGroupMembersSchema }) dto: AddGroupMembersDto,
  ) {
    return ok(await this.service.addGroupMembers(id, getAuthUser(req).id, dto.memberIds));
  }

  @Delete(":id/members/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    await this.service.removeGroupMember(id, getAuthUser(req).id, userId);
  }

  @Patch(":id/members/:userId/role")
  async updateMemberRole(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body({ schema: updateMemberRoleSchema }) dto: UpdateMemberRoleDto,
  ) {
    await this.service.updateGroupRole(id, getAuthUser(req).id, userId, dto.role);
    return ok({ conversationId: id, userId, role: dto.role });
  }

  @Post(":id/transfer-ownership")
  async transferOwnership(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) id: string,
    @Body({ schema: transferOwnershipSchema }) dto: TransferOwnershipDto,
  ) {
    await this.service.transferGroupOwnership(id, getAuthUser(req).id, dto.userId);
    return ok({ conversationId: id, ownerId: dto.userId });
  }

  @Post(":id/leave")
  async leaveGroup(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) id: string) {
    return ok(await this.service.leaveGroup(id, getAuthUser(req).id));
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
