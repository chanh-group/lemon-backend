import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
  Req,
} from "@nestjs/common";
import {
  MemoryRateLimiter,
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

@Controller("files")
export class FileController {
  constructor(
    private readonly fileService: FileService,
    @Optional()
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter = new MemoryRateLimiter(),
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
}
