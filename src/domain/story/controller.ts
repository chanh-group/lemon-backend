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
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  RATE_LIMITER,
  RATE_LIMIT_STORY_REACT_IP_MAX,
  RATE_LIMIT_STORY_REACT_USER_MAX,
  RATE_LIMIT_STORY_REPLY_IP_MAX,
  RATE_LIMIT_STORY_REPLY_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { BusinessError } from "../../utils/errors/business.js";
import { messageOnly, ok, withMessage } from "../../utils/response.js";
import { getAuthUser, parseCursorPage, type AuthUser } from "../shared.js";
import {
  createStorySchema,
  reactStorySchema,
  replyStorySchema,
  type CreateStoryDto,
  type ReactStoryDto,
  type ReplyStoryDto,
} from "./dto/request.js";
import { StoryService } from "./service.js";

@Controller("stories")
export class StoryController {
  constructor(
    private readonly storyService: StoryService,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

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
  async getViewers(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const page = parseCursorPage(cursor, limit);
    const data = await this.storyService.getViewers(userId, storyId, page.cursor, page.size);
    return ok(data);
  }

  @Post(":id/react")
  @HttpCode(HttpStatus.OK)
  async reactStory(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Body({ schema: reactStorySchema }) dto: ReactStoryDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.assertReactRateLimit(req, userId);
    const data = await this.storyService.reactStory(userId, storyId, dto.emoji);
    return withMessage(data, t("STORY_REACTION_ADDED", lang));
  }

  @Delete(":id/react")
  async unreactStory(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.assertReactRateLimit(req, userId);
    await this.storyService.unreactStory(userId, storyId);
    return messageOnly(t("STORY_REACTION_REMOVED", lang));
  }

  @Get(":id/reactions")
  async getReactions(
    @Req() req: { user?: unknown },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const page = parseCursorPage(cursor, limit);
    const data = await this.storyService.getReactions(userId, storyId, page.cursor, page.size);
    return ok(data);
  }

  @Post(":id/reply")
  @HttpCode(HttpStatus.CREATED)
  async replyStory(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Param("id", ParseUUIDPipe) storyId: string,
    @Body({ schema: replyStorySchema }) dto: ReplyStoryDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const allowed = await this.rateLimiter.checkMixedLimit(
      "story-reply",
      userId,
      extractClientIp(req),
      RATE_LIMIT_STORY_REPLY_USER_MAX,
      RATE_LIMIT_STORY_REPLY_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    if (!allowed) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    const data = await this.storyService.replyStory(userId, storyId, dto);
    return withMessage(data, t("STORY_REPLIED", lang));
  }

  private async assertReactRateLimit(
    req: { ip?: string; socket?: { remoteAddress?: string | null } },
    userId: string,
  ): Promise<void> {
    const allowed = await this.rateLimiter.checkMixedLimit(
      "story-react",
      userId,
      extractClientIp(req),
      RATE_LIMIT_STORY_REACT_USER_MAX,
      RATE_LIMIT_STORY_REACT_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    if (!allowed) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
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
