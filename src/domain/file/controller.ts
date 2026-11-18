import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  CHAT_MAX_FILE_BYTES,
  STORY_MAX_VIDEO_BYTES,
  USER_AVATAR_MAX_BYTES,
} from "../../utils/cache/constants.js";
import {
  RATE_LIMITER,
  RATE_LIMIT_PRESIGN_IP_MAX,
  RATE_LIMIT_PRESIGN_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  assertMixedRateLimit,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { BusinessError } from "../../utils/errors/business.js";
import { ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { parseSchemaIssues } from "../../utils/validation.js";
import { fileUploadSchema, presignFileSchema, type PresignFileDto } from "./dto/request.js";
import { UploadRateLimitInterceptor } from "./upload-rate-limit.interceptor.js";
import { FileService } from "./service.js";
import { Public } from "../../utils/decorators.js";
import { UserService } from "../user/service.js";
import { ConversationService } from "../conversation/service.js";

interface UploadedMulterFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

@Controller("files")
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(
    private readonly fileService: FileService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
    private readonly userService: UserService,
    private readonly conversationService: ConversationService,
  ) {}

  @Get("avatars/:userId/:fileName")
  @Public()
  @Header("Cache-Control", "no-store")
  async getAvatar(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("fileName") fileName: string,
    @Res() response: Response,
  ) {
    const user = await this.userService.findById(userId);
    const url = await this.fileService.getAvatarDownloadUrl(userId, fileName, user?.avatarUrl);
    return response.redirect(HttpStatus.FOUND, url);
  }

  @Get("group-avatars/:groupId/:fileName")
  @Header("Cache-Control", "private, no-store")
  async getGroupAvatar(
    @Req() req: { user?: unknown },
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Param("fileName") fileName: string,
    @Res() response: Response,
  ) {
    const userId = getAuthUser(req).id;
    const object = await this.fileService.getGroupAvatar(userId, groupId, fileName);
    response.setHeader("Content-Type", object.contentType);
    response.setHeader("Content-Length", object.contentLength);
    response.setHeader("Cache-Control", "private, no-store");
    return response.end(Buffer.from(object.body));
  }

  @Post("group-avatars/:groupId/upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    UploadRateLimitInterceptor,
    FileInterceptor("file", {
      limits: { fileSize: USER_AVATAR_MAX_BYTES, files: 1, fields: 2, fieldSize: 256, parts: 3 },
    }),
  )
  async uploadGroupAvatar(
    @Req() req: { user?: unknown },
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    if (!file) throw new BusinessError("BAD_REQUEST");
    const actorId = getAuthUser(req).id;
    const current = await this.conversationService.getById(groupId, actorId);
    if (current.myRole !== "ADMIN") throw new BusinessError("FORBIDDEN");
    const avatarUrl = await this.fileService.uploadGroupAvatar(actorId, groupId, file);
    try {
      await this.conversationService.updateGroupAvatar(groupId, actorId, avatarUrl);
    } catch (error) {
      let currentAvatarUrl: string | null | undefined;
      try {
        const check = await this.conversationService.getById(groupId, actorId);
        currentAvatarUrl = check.avatarUrl;
      } catch (checkError) {
        this.logger.warn("Group avatar write outcome could not be verified; retaining object", {
          err: checkError,
          groupId,
        });
        throw error;
      }
      if (currentAvatarUrl !== avatarUrl) {
        try {
          await this.fileService.deleteGroupAvatarObject(groupId, avatarUrl);
        } catch (cleanupError) {
          this.logger.warn("Failed to remove unreferenced group avatar object", {
            err: cleanupError,
            groupId,
          });
        }
      }
      throw error;
    }
    return ok(await this.conversationService.getById(groupId, actorId));
  }

  @Post("presign")
  @HttpCode(HttpStatus.OK)
  async presignFile(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @Body({ schema: presignFileSchema }) dto: PresignFileDto,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await assertMixedRateLimit(
      this.rateLimiter,
      "presign-file",
      userId,
      extractClientIp(req),
      RATE_LIMIT_PRESIGN_USER_MAX,
      RATE_LIMIT_PRESIGN_IP_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    const data = await this.fileService.presign(userId, dto);
    return ok(data);
  }

  @Post("avatars/upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    UploadRateLimitInterceptor,
    FileInterceptor("file", {
      limits: { fileSize: USER_AVATAR_MAX_BYTES, files: 1, fields: 2, fieldSize: 256, parts: 3 },
    }),
  )
  async uploadAvatar(
    @Req() req: { user?: unknown },
    @UploadedFile() file: UploadedMulterFile | undefined,
  ) {
    if (!file) throw new BusinessError("BAD_REQUEST");
    const { id: userId }: AuthUser = getAuthUser(req);
    return ok(
      await this.fileService.upload(
        userId,
        {
          buffer: file.buffer,
          size: file.size,
          mimetype: file.mimetype,
          originalname: file.originalname,
        },
        "USER_AVATAR",
      ),
    );
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    UploadRateLimitInterceptor,
    FileInterceptor("file", {
      limits: {
        fileSize: Math.max(CHAT_MAX_FILE_BYTES, STORY_MAX_VIDEO_BYTES),
        files: 1,
        fields: 2,
        fieldSize: 256,
        parts: 3,
      },
    }),
  )
  async uploadFile(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body("kind") kind: unknown,
    @Body("conversationId") conversationId?: string,
  ) {
    if (!file) {
      throw new BusinessError("BAD_REQUEST");
    }
    const parsed = fileUploadSchema.safeParse({ kind, conversationId });
    if (!parsed.success) {
      throw BusinessError.validation(parseSchemaIssues(parsed.error.issues));
    }
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.fileService.upload(
      userId,
      {
        buffer: file.buffer,
        size: file.size,
        mimetype: file.mimetype,
        originalname: file.originalname,
      },
      parsed.data.kind,
      parsed.data.conversationId,
    );
    return ok(data);
  }
}
