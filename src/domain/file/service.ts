import { Inject, Injectable, Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  CHAT_ALLOWED_AUDIO_MIME,
  CHAT_ALLOWED_IMAGE_MIME,
  CHAT_ALLOWED_VIDEO_MIME,
  CHAT_MAX_FILE_BYTES,
  DISALLOWED_FILE_EXTENSIONS,
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

const UPLOAD_RULES: Record<
  PresignFileDto["kind"],
  { maxBytes: number; allowedMimes?: readonly string[] }
> = {
  STORY_IMAGE: { maxBytes: STORY_MAX_IMAGE_BYTES, allowedMimes: STORY_ALLOWED_IMAGE_MIME },
  STORY_VIDEO: { maxBytes: STORY_MAX_VIDEO_BYTES, allowedMimes: STORY_ALLOWED_VIDEO_MIME },
  CHAT_IMAGE: { maxBytes: CHAT_MAX_FILE_BYTES, allowedMimes: CHAT_ALLOWED_IMAGE_MIME },
  CHAT_VIDEO: { maxBytes: CHAT_MAX_FILE_BYTES, allowedMimes: CHAT_ALLOWED_VIDEO_MIME },
  CHAT_AUDIO: { maxBytes: CHAT_MAX_FILE_BYTES, allowedMimes: CHAT_ALLOWED_AUDIO_MIME },
  CHAT_FILE: { maxBytes: CHAT_MAX_FILE_BYTES },
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  async presign(userId: string, dto: PresignFileDto): Promise<PresignFileResponse> {
    const rules = UPLOAD_RULES[dto.kind];

    if (dto.sizeBytes > rules.maxBytes) {
      throw new BusinessError("FILE_TOO_LARGE", {
        maxMb: String(Math.floor(rules.maxBytes / BYTES_PER_MB)),
      });
    }

    if (rules.allowedMimes && !rules.allowedMimes.includes(dto.mimeType)) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: dto.mimeType });
    }

    let ext = MIME_EXTENSION_MAP[dto.mimeType];
    let sanitizedFileName = "";

    if (dto.fileName) {
      const parts = dto.fileName.split(".");
      const candidateExt = parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
      if (candidateExt && (DISALLOWED_FILE_EXTENSIONS as readonly string[]).includes(candidateExt)) {
        throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: dto.mimeType });
      }
      if (!ext && candidateExt) {
        ext = candidateExt;
      }
      sanitizedFileName = dto.fileName
        .replace(/[^\w.-]/g, "_")
        .slice(0, 100);
    }

    if (!ext) {
      ext = "bin";
    }

    let objectKey: string;
    if (dto.kind.startsWith("STORY_")) {
      objectKey = `stories/${userId}/${uuidv7()}.${ext}`;
    } else {
      const scope = dto.conversationId ?? userId;
      objectKey = sanitizedFileName
        ? `chat/${scope}/${uuidv7()}-${sanitizedFileName}`
        : `chat/${scope}/${uuidv7()}.${ext}`;
    }

    try {
      const { uploadUrl } = await this.storage.presignPut({ objectKey, mimeType: dto.mimeType });
      this.logger.log("Presigned media upload", { userId, kind: dto.kind, objectKey });
      return { uploadUrl, objectKey };
    } catch (err) {
      if (err instanceof StorageError) {
        throw new BusinessError("PRESIGN_FAILED");
      }
      throw err;
    }
  }

  async upload(
    userId: string,
    file: { buffer: Buffer; size: number; mimetype: string; originalname: string },
    kind: PresignFileDto["kind"],
    conversationId?: string,
  ): Promise<{ objectKey: string }> {
    const rules = UPLOAD_RULES[kind];

    if (file.size > rules.maxBytes) {
      throw new BusinessError("FILE_TOO_LARGE", {
        maxMb: String(Math.floor(rules.maxBytes / BYTES_PER_MB)),
      });
    }

    if (rules.allowedMimes && !rules.allowedMimes.includes(file.mimetype)) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: file.mimetype });
    }

    let ext = MIME_EXTENSION_MAP[file.mimetype];
    let sanitizedFileName = "";

    if (file.originalname) {
      const parts = file.originalname.split(".");
      const candidateExt = parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
      if (candidateExt && (DISALLOWED_FILE_EXTENSIONS as readonly string[]).includes(candidateExt)) {
        throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType: file.mimetype });
      }
      if (!ext && candidateExt) {
        ext = candidateExt;
      }
      sanitizedFileName = file.originalname
        .replace(/[^\w.-]/g, "_")
        .slice(0, 100);
    }

    if (!ext) {
      ext = "bin";
    }

    let objectKey: string;
    if (kind.startsWith("STORY_")) {
      objectKey = `stories/${userId}/${uuidv7()}.${ext}`;
    } else {
      const scope = conversationId ?? userId;
      objectKey = sanitizedFileName
        ? `chat/${scope}/${uuidv7()}-${sanitizedFileName}`
        : `chat/${scope}/${uuidv7()}.${ext}`;
    }

    try {
      await this.storage.putObject({
        objectKey,
        body: file.buffer,
        mimeType: file.mimetype,
      });
      this.logger.log("Direct media upload fallback success", { userId, kind, objectKey });
      return { objectKey };
    } catch (err) {
      if (err instanceof StorageError) {
        throw new BusinessError("PRESIGN_FAILED");
      }
      throw err;
    }
  }
}
