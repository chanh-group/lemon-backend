import {
  Body,
  Controller,
  createParamDecorator,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import type { CreateStoryDto } from "./dto/request.js";
import { StoryService } from "./service.js";

export function extractUserIdFromContext(ctx: ExecutionContext): string {
  const request = ctx.switchToHttp().getRequest<{
    user?: { id?: string };
    headers: Record<string, string | string[] | undefined>;
  }>();
  const headerUserId = request.headers["x-user-id"];
  const resolvedUserId =
    request.user?.id ?? (typeof headerUserId === "string" ? headerUserId : undefined);

  if (!resolvedUserId) {
    throw new UnauthorizedException("Unauthorized: missing user context");
  }
  return resolvedUserId;
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => extractUserIdFromContext(ctx),
);

@Controller("stories")
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStory(@CurrentUserId() userId: string, @Body() dto: CreateStoryDto) {
    const data = await this.storyService.createStory(userId, dto);
    return {
      success: true,
      message: "Story created successfully",
      data,
    };
  }

  @Get("feed")
  async getFeed(@CurrentUserId() userId: string) {
    const data = await this.storyService.getFeed(userId);
    return {
      success: true,
      message: "OK",
      data,
    };
  }

  @Get(":id")
  async getStoryById(@CurrentUserId() userId: string, @Param("id") storyId: string) {
    const data = await this.storyService.getStoryById(userId, storyId);
    return {
      success: true,
      message: "OK",
      data,
    };
  }

  @Post(":id/view")
  @HttpCode(HttpStatus.OK)
  async viewStory(@CurrentUserId() userId: string, @Param("id") storyId: string) {
    await this.storyService.viewStory(userId, storyId);
    return {
      success: true,
      message: "Story marked as viewed",
    };
  }

  @Get(":id/views")
  async getViewers(@CurrentUserId() userId: string, @Param("id") storyId: string) {
    const data = await this.storyService.getViewers(userId, storyId);
    return {
      success: true,
      message: "OK",
      data,
    };
  }

  @Delete(":id")
  async deleteStory(@CurrentUserId() userId: string, @Param("id") storyId: string) {
    await this.storyService.deleteStory(userId, storyId);
    return {
      success: true,
      message: "Story deleted successfully",
    };
  }
}
