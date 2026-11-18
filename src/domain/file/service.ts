import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
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
  USER_AVATAR_ALLOWED_MIME,
  USER_AVATAR_MAX_BYTES,
} from "../../utils/cache/constants.js";
import { BusinessError } from "../../utils/errors/business.js";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../conversation/repository.js";
import { StorageError } from "../../utils/storage/error.js";
import { STORAGE_SERVICE, type StorageService } from "../../utils/storage/store.js";
import {
  avatarObjectKeyFromUrl,
  avatarUrlForObjectKey,
  groupAvatarObjectKeyFromUrl,
  groupAvatarUrlForObjectKey,
  isAvatarFileName,
} from "../../utils/storage/avatar.js";
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
  USER_AVATAR: { maxBytes: USER_AVATAR_MAX_BYTES, allowedMimes: USER_AVATAR_ALLOWED_MIME },
};

function validateUpload(kind: PresignFileDto["kind"], size: number, mimeType: string) {
  const rules = UPLOAD_RULES[kind];
  if (size > rules.maxBytes) {
    throw new BusinessError("FILE_TOO_LARGE", {
      maxMb: String(Math.floor(rules.maxBytes / BYTES_PER_MB)),
    });
  }
  if (rules.allowedMimes && !rules.allowedMimes.includes(mimeType)) {
    throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType });
  }
}

function createObjectKey(
  userId: string,
  kind: PresignFileDto["kind"],
  mimeType: string,
  fileName: string,
  conversationId?: string,
): string {
  let ext = MIME_EXTENSION_MAP[mimeType];
  let sanitizedFileName = "";

  if (fileName) {
    const parts = fileName.split(".");
    const candidateExt = parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
    if (candidateExt && (DISALLOWED_FILE_EXTENSIONS as readonly string[]).includes(candidateExt)) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED", { mimeType });
    }
    if (!ext && candidateExt) ext = candidateExt;
    sanitizedFileName = fileName.replace(/[^\w.-]/g, "_").slice(0, 100);
  }

  ext ??= "bin";
  if (kind === "USER_AVATAR") return `avatars/${userId}/${uuidv7()}.${ext}`;
  if (kind.startsWith("STORY_")) return `stories/${userId}/${uuidv7()}.${ext}`;
  if (!conversationId) throw new BusinessError("BAD_REQUEST");
  const prefix = `chat/${conversationId}/${userId}/${uuidv7()}`;
  return sanitizedFileName ? `${prefix}-${sanitizedFileName}` : `${prefix}.${ext}`;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Optional()
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations?: ConversationRepository,
  ) {}

  private async assertChatMember(
    userId: string,
    kind: string,
    conversationId?: string,
  ): Promise<void> {
    if (!kind.startsWith("CHAT_")) return;
    if (
      !conversationId ||
      !this.conversations ||
      !(await this.conversations.isParticipant(conversationId, userId))
    ) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
  }

  async presign(userId: string, dto: PresignFileDto): Promise<PresignFileResponse> {
    validateUpload(dto.kind, dto.sizeBytes, dto.mimeType);
    const objectKey = createObjectKey(
      userId,
      dto.kind,
      dto.mimeType,
      dto.fileName ?? "",
      dto.conversationId,
    );
    await this.assertChatMember(userId, dto.kind, dto.conversationId);

    try {
      const avatarUrl =
        dto.kind === "USER_AVATAR" ? avatarUrlForObjectKey(userId, objectKey) : undefined;
      const { uploadUrl } = await this.storage.presignPut({
        objectKey,
        mimeType: dto.mimeType,
        ...(dto.kind === "USER_AVATAR" && { contentLength: dto.sizeBytes }),
      });
      this.logger.log("Presigned media upload", { userId, kind: dto.kind, objectKey });
      return { uploadUrl, objectKey, ...(avatarUrl && { avatarUrl }) };
    } catch (err) {
      if (err instanceof StorageError) {
        throw new BusinessError("PRESIGN_FAILED");
      }
      throw err;
    }
  }

  async getAvatarDownloadUrl(
    userId: string,
    fileName: string,
    currentAvatarUrl?: string | null,
  ): Promise<string> {
    if (!isAvatarFileName(fileName)) throw new BusinessError("USER_NOT_FOUND");
    const objectKey = `avatars/${userId}/${fileName}`;
    if (avatarObjectKeyFromUrl(currentAvatarUrl ?? "", userId) !== objectKey) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    const object = await this.storage.headObject(objectKey);
    if (!object) throw new BusinessError("USER_NOT_FOUND");
    if (object.contentLength > USER_AVATAR_MAX_BYTES) {
      throw new BusinessError("FILE_TOO_LARGE", { maxMb: "5" });
    }
    if (
      object.contentLength < 1 ||
      !(USER_AVATAR_ALLOWED_MIME as readonly string[]).includes(object.contentType)
    ) {
      throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
    }
    const { downloadUrl } = await this.storage.presignGet({
      objectKey,
      fileName,
      disposition: "inline",
      mimeType: object.contentType,
    });
    return downloadUrl;
  }

  async getGroupAvatar(
    userId: string,
    groupId: string,
    fileName: string,
  ): Promise<{ body: Uint8Array; contentType: string; contentLength: number }> {
    if (!isAvatarFileName(fileName) || !this.conversations) {
      throw new BusinessError("CONVERSATION_NOT_FOUND");
    }
    const isParticipant = await this.conversations.isParticipant(groupId, userId);
    if (!isParticipant) {
      throw new BusinessError("NOT_PARTICIPANT");
    }
    const currentUrl = await this.conversations.getGroupAvatarUrl(groupId);
    const objectKey = groupAvatarObjectKeyFromUrl(currentUrl ?? "", groupId);
    if (objectKey !== `group-avatars/${groupId}/${fileName}`) {
      throw new BusinessError("CONVERSATION_NOT_FOUND");
    }
    const object = await this.storage.getObject(objectKey);
    if (!object) throw new BusinessError("CONVERSATION_NOT_FOUND");
    validateUpload("USER_AVATAR", object.contentLength, object.contentType);
    if (object.contentLength < 1) throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
    return object;
  }

  async uploadGroupAvatar(
    userId: string,
    groupId: string,
    file: { buffer: Buffer; size: number; mimetype: string },
  ): Promise<string> {
    if (!this.conversations) throw new BusinessError("FORBIDDEN");
    const group = await this.conversations.findById(groupId, userId);
    if (!group || group.kind !== "GROUP") throw new BusinessError("NOT_PARTICIPANT");
    if (group.myRole !== "ADMIN") throw new BusinessError("FORBIDDEN");
    if (file.size < 1) throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
    validateUpload("USER_AVATAR", file.size, file.mimetype);
    const ext = MIME_EXTENSION_MAP[file.mimetype];
    if (!ext) throw new BusinessError("FILE_TYPE_NOT_ALLOWED");
    const objectKey = `group-avatars/${groupId}/${uuidv7()}.${ext}`;
    try {
      await this.storage.putObject({
        objectKey,
        body: file.buffer,
        mimeType: file.mimetype,
      });
      this.logger.log("Uploaded group avatar", { userId, groupId, objectKey });
      return groupAvatarUrlForObjectKey(groupId, objectKey);
    } catch (err) {
      if (err instanceof StorageError) throw new BusinessError("PRESIGN_FAILED");
      throw err;
    }
  }

  async deleteGroupAvatarObject(
    groupId: string,
    avatarUrl: string | null | undefined,
  ): Promise<void> {
    if (!avatarUrl) return;
    const objectKey = groupAvatarObjectKeyFromUrl(avatarUrl, groupId);
    if (!objectKey) return;
    await this.storage.deleteObjects([objectKey]);
  }

  async upload(
    userId: string,
    file: { buffer: Buffer; size: number; mimetype: string; originalname: string },
    kind: PresignFileDto["kind"],
    conversationId?: string,
  ): Promise<{ objectKey: string; avatarUrl?: string }> {
    validateUpload(kind, file.size, file.mimetype);
    const objectKey = createObjectKey(
      userId,
      kind,
      file.mimetype,
      file.originalname,
      conversationId,
    );
    await this.assertChatMember(userId, kind, conversationId);
    const avatarUrl = kind === "USER_AVATAR" ? avatarUrlForObjectKey(userId, objectKey) : undefined;

    try {
      await this.storage.putObject({
        objectKey,
        body: file.buffer,
        mimeType: file.mimetype,
      });
      this.logger.log("Direct media upload fallback success", { userId, kind, objectKey });
      return { objectKey, ...(avatarUrl && { avatarUrl }) };
    } catch (err) {
      if (err instanceof StorageError) {
        throw new BusinessError("PRESIGN_FAILED");
      }
      throw err;
    }
  }
}
