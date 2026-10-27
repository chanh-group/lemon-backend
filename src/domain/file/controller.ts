import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CHAT_MAX_FILE_BYTES, STORY_MAX_VIDEO_BYTES } from "../../utils/cache/constants.js";
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

interface UploadedMulterFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

@Controller("files")
export class FileController {
  constructor(
    private readonly fileService: FileService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

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
