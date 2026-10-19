import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ok } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { presignFileSchema, type PresignFileDto } from "./dto/request.js";
import { FileService } from "./service.js";

@Controller("files")
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post("presign")
  @HttpCode(HttpStatus.OK)
  async presignFile(
    @Req() req: { user?: unknown },
    @Body({ schema: presignFileSchema }) dto: PresignFileDto,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.fileService.presign(userId, dto);
    return ok(data);
  }
}
