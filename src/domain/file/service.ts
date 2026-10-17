import { Inject, Injectable, Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  MIME_EXTENSION_MAP,
  STORY_ALLOWED_IMAGE_MIME,
  STORY_ALLOWED_VIDEO_MIME,
  STORY_MAX_IMAGE_BYTES,
  STORY_MAX_VIDEO_BYTES,
} from "../../utils/cache/constants.js";
import { BusinessError } from "../../utils/errors/business.js";
import { StorageError } from "../../utils/storage/error.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import type { PresignFileDto } from "./dto/request.js";
import type { PresignFileResponse } from "./dto/response.js";

const BYTES_PER_MB = 1024 * 1024;

const STORY_UPLOAD_RULES: Record<
  PresignFileDto["kind"],
  { maxBytes: number; allowedMimes: readonly string[] }
> = {
  STORY_IMAGE: { maxBytes: STORY_MAX_IMAGE_BYTES, allowedMimes: STORY_ALLOWED_IMAGE_MIME },
  STORY_VIDEO: { maxBytes: STORY_MAX_VIDEO_BYTES, allowedMimes: STORY_ALLOWED_VIDEO_MIME },
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  async presign(userId: string, dto: PresignFileDto): Promise<PresignFileResponse> {
    const rules = STORY_UPLOAD_RULES[dto.kind];

    if (dto.sizeBytes > rules.maxBytes) {
      throw new BusinessError("FILE_TOO_LARGE", {
        maxMb: String(Math.floor(rules.maxBytes / BYTES_PER_MB)),
      });
    }
    if (!rules.allowedMimes.includes(dto.mimeType)) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: dto.mimeType });
    }

    const ext = MIME_EXTENSION_MAP[dto.mimeType];
    if (ext === undefined) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: dto.mimeType });
    }

    const objectKey = `stories/${userId}/${uuidv7()}.${ext}`;

    try {
      const { uploadUrl } = await this.storage.presignPut({ objectKey, mimeType: dto.mimeType });
      this.logger.log("Presigned story media upload", { userId, kind: dto.kind, objectKey });
      return { uploadUrl, objectKey };
    } catch (err) {
      if (err instanceof StorageError) {
        throw new BusinessError("PRESIGN_FAILED");
      }
      throw err;
    }
  }
}
