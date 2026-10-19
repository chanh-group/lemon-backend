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
import { messageOnly, ok, withMessage } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { createStorySchema, type CreateStoryDto } from "./dto/request.js";
import { StoryService } from "./service.js";

@Controller("stories")
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStory(
    @Req() req: { user?: unknown },
    @Body({ schema: createStorySchema }) dto: CreateStoryDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.storyService.createStory(userId, dto);
    return withMessage(data, t("STORY_CREATED", lang));
  }

  @Get("feed")
  async getFeed(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.storyService.getFeed(userId);
    return ok(data);
  }

  @Get(":id")
  async getStoryById(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) storyId: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.storyService.getStoryById(userId, storyId);
    return ok(data);
  }

  @Post(":id/view")
  @HttpCode(HttpStatus.OK)
  async viewStory(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.storyService.viewStory(userId, storyId);
    return messageOnly(t("STORY_VIEWED", lang));
  }

  @Get(":id/views")
  async getViewers(@Req() req: { user?: unknown }, @Param("id", ParseUUIDPipe) storyId: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.storyService.getViewers(userId, storyId);
    return ok(data);
  }

  @Delete(":id")
  async deleteStory(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.storyService.deleteStory(userId, storyId);
    return messageOnly(t("STORY_DELETED", lang));
  }
}
