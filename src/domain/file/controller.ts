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
import {
  RATE_LIMITER,
  RATE_LIMIT_PRESIGN_IP_MAX,
  RATE_LIMIT_PRESIGN_USER_MAX,
  RATE_LIMIT_WINDOW_SECS,
  extractClientIp,
  type RateLimiter,
} from "../../middleware/ratelimit.js";
import { BusinessError } from "../../utils/errors/business.js";
import { ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { presignFileSchema, type PresignFileDto } from "./dto/request.js";
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
    if (
      !(await this.rateLimiter.checkMixedLimit(
        "presign-file",
        userId,
        extractClientIp(req),
        RATE_LIMIT_PRESIGN_USER_MAX,
        RATE_LIMIT_PRESIGN_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    const data = await this.fileService.presign(userId, dto);
    return ok(data);
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @Req() req: { user?: unknown; ip?: string; socket?: { remoteAddress?: string | null } },
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body("kind") kind: PresignFileDto["kind"],
    @Body("conversationId") conversationId?: string,
  ) {
    if (!file) {
      throw new BusinessError("BAD_REQUEST");
    }
    const { id: userId }: AuthUser = getAuthUser(req);
    if (
      !(await this.rateLimiter.checkMixedLimit(
        "upload-file",
        userId,
        extractClientIp(req),
        RATE_LIMIT_PRESIGN_USER_MAX,
        RATE_LIMIT_PRESIGN_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    const data = await this.fileService.upload(
      userId,
      {
        buffer: file.buffer,
        size: file.size,
        mimetype: file.mimetype,
        originalname: file.originalname,
      },
      kind,
      conversationId,
    );
    return ok(data);
  }
}
