import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileService } from "../../../../src/domain/file/service.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";
import { StorageError } from "../../../../src/utils/storage/error.js";
import {
  avatarUrlForObjectKey,
  groupAvatarUrlForObjectKey,
} from "../../../../src/utils/storage/avatar.js";
import type { ConversationRepository } from "../../../../src/domain/conversation/repository.js";

describe("FileService", () => {
  let service: FileService;
  let presignPutMock: Mock<
    (params: {
      objectKey: string;
      mimeType: string;
      contentLength?: number;
    }) => Promise<{ uploadUrl: string }>
  >;
  let putObjectMock: Mock<
    (params: { objectKey: string; body: Buffer; mimeType: string }) => Promise<void>
  >;
  let headObjectMock: Mock;
  let getObjectMock: Mock;
  let presignGetMock: Mock;
  let isParticipantMock: Mock;
  let findByIdMock: Mock;
  let getGroupAvatarUrlMock: Mock;

  const storage = () =>
    ({
      presignPut: presignPutMock,
      putObject: putObjectMock,
      headObject: headObjectMock,
      getObject: getObjectMock,
      presignGet: presignGetMock,
    }) as unknown as StorageService;

  beforeEach(() => {
    presignPutMock = vi.fn().mockResolvedValue({ uploadUrl: "https://s3.example/signed" });
    putObjectMock = vi.fn().mockResolvedValue(undefined);
    headObjectMock = vi.fn().mockResolvedValue({ contentLength: 1024, contentType: "image/png" });
    getObjectMock = vi.fn().mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentLength: 3,
      contentType: "image/png",
    });
    presignGetMock = vi.fn().mockResolvedValue({ downloadUrl: "https://s3.example/avatar" });
    isParticipantMock = vi.fn().mockResolvedValue(true);
    findByIdMock = vi.fn().mockResolvedValue({ kind: "GROUP", myRole: "ADMIN" });
    getGroupAvatarUrlMock = vi.fn();
    service = new FileService(storage(), {
      isParticipant: isParticipantMock,
      findById: findByIdMock,
      getGroupAvatarUrl: getGroupAvatarUrlMock,
    } as unknown as ConversationRepository);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uploads an avatar for an active group admin and gives it a group-scoped URL", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    findByIdMock.mockResolvedValueOnce({ kind: "GROUP", myRole: "ADMIN" });
    const groupId = "0193a2b1-0000-7000-8000-000000000010";
    const file = { buffer: Buffer.from("image"), size: 5, mimetype: "image/png" };

    const url = await service.uploadGroupAvatar("user-1", groupId, file);

    const objectKey = putObjectMock.mock.calls[0][0].objectKey;
    expect(objectKey).toMatch(new RegExp(`^group-avatars/${groupId}/[0-9a-f-]+\\.png$`));
    expect(url).toBe(groupAvatarUrlForObjectKey(groupId, objectKey));
    expect(findByIdMock).toHaveBeenCalledWith(groupId, "user-1");
  });

  it("rejects group avatar upload for a regular member", async () => {
    findByIdMock.mockResolvedValueOnce({ kind: "GROUP", myRole: "MEMBER" });
    const groupId = "0193a2b1-0000-7000-8000-000000000010";
    const file = { buffer: Buffer.from("image"), size: 5, mimetype: "image/png" };

    await expect(service.uploadGroupAvatar("user-1", groupId, file)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("does not store a group avatar for a nonmember", async () => {
    findByIdMock.mockResolvedValueOnce(null);
    await expect(
      service.uploadGroupAvatar("user-1", "group-1", {
        buffer: Buffer.from("image"),
        size: 5,
        mimetype: "image/png",
      }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("serves only the currently attached group avatar to active participants", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const groupId = "0193a2b1-0000-7000-8000-000000000010";
    const fileName = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png";
    const objectKey = `group-avatars/${groupId}/${fileName}`;

    isParticipantMock.mockResolvedValueOnce(false);
    await expect(service.getGroupAvatar("user-1", groupId, fileName)).rejects.toMatchObject({
      code: "NOT_PARTICIPANT",
    });

    getGroupAvatarUrlMock.mockResolvedValueOnce(null);
    await expect(service.getGroupAvatar("user-1", groupId, fileName)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });

    const newerFileName = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6c.png";
    getGroupAvatarUrlMock.mockResolvedValueOnce(
      groupAvatarUrlForObjectKey(groupId, `group-avatars/${groupId}/${newerFileName}`),
    );
    await expect(service.getGroupAvatar("user-1", groupId, fileName)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });

    getGroupAvatarUrlMock.mockResolvedValueOnce(groupAvatarUrlForObjectKey(groupId, objectKey));
    const result = await service.getGroupAvatar("user-1", groupId, fileName);
    expect(result.contentType).toBe("image/png");
    expect(getObjectMock).toHaveBeenCalledWith(objectKey);
  });

  it("presigns an image upload with a server-generated user-scoped key", async () => {
    const result = await service.presign("user-1", {
      kind: "STORY_IMAGE",
      sizeBytes: 1024,
      mimeType: "image/jpeg",
    });

    expect(result.uploadUrl).toBe("https://s3.example/signed");
    expect(result.objectKey).toMatch(
      /^stories\/user-1\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
    );
    expect(presignPutMock).toHaveBeenCalledWith({
      objectKey: result.objectKey,
      mimeType: "image/jpeg",
    });
  });

  it("presigns an avatar upload with an avatars/ prefix", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const result = await service.presign("user-1", {
      kind: "USER_AVATAR",
      sizeBytes: 2048,
      mimeType: "image/png",
    });

    expect(result.uploadUrl).toBe("https://s3.example/signed");
    expect(result.objectKey).toMatch(
      /^avatars\/user-1\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    );
    expect(result.avatarUrl).toBe(avatarUrlForObjectKey("user-1", result.objectKey));
    expect(presignPutMock).toHaveBeenCalledWith({
      objectKey: result.objectKey,
      mimeType: "image/png",
      contentLength: 2048,
    });
  });

  it("creates a short-lived download URL for a user-scoped avatar", async () => {
    vi.stubEnv("API_PUBLIC_URL", "https://api.example.com");
    const userId = "0193a2b1-0000-7000-8000-000000000001";
    const fileName = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png";
    const objectKey = `avatars/${userId}/${fileName}`;
    const url = await service.getAvatarDownloadUrl(
      userId,
      fileName,
      avatarUrlForObjectKey(userId, objectKey),
    );

    expect(url).toBe("https://s3.example/avatar");
    expect(headObjectMock).toHaveBeenCalledWith(objectKey);
    expect(presignGetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey,
        disposition: "inline",
        mimeType: "image/png",
      }),
    );
  });

  it("rejects avatar paths outside the generated filename format", async () => {
    await expect(service.getAvatarDownloadUrl("user-1", "../../secret.png")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(headObjectMock).not.toHaveBeenCalled();
  });

  it("maps every allowed image MIME to its extension", async () => {
    const cases = [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["image/gif", "gif"],
    ] as const;

    for (const [mimeType, ext] of cases) {
      const result = await service.presign("user-1", {
        kind: "STORY_IMAGE",
        sizeBytes: 1024,
        mimeType,
      });
      expect(result.objectKey.endsWith(`.${ext}`)).toBe(true);
    }
  });

  it("accepts story images and videos at the 25 MiB boundary", async () => {
    for (const [kind, mimeType] of [
      ["STORY_IMAGE", "image/jpeg"],
      ["STORY_VIDEO", "video/mp4"],
    ] as const) {
      await expect(
        service.presign("user-1", { kind, mimeType, sizeBytes: 25 * 1024 * 1024 }),
      ).resolves.toMatchObject({ uploadUrl: expect.any(String) });
    }
  });

  it("rejects oversized story uploads with FILE_TOO_LARGE carrying maxMb", async () => {
    for (const [kind, mimeType] of [
      ["STORY_IMAGE", "image/jpeg"],
      ["STORY_VIDEO", "video/mp4"],
    ] as const) {
      await expect(
        service.presign("user-1", { kind, mimeType, sizeBytes: 25 * 1024 * 1024 + 1 }),
      ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", params: { maxMb: "25" } });
    }
  });

  it("rejects MIME types outside the kind allowlist", async () => {
    await expect(
      service.presign("user-1", {
        kind: "STORY_IMAGE",
        sizeBytes: 1024,
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
  });

  it("fails closed with PRESIGN_FAILED when storage errors", async () => {
    presignPutMock.mockRejectedValueOnce(new StorageError("boom"));

    await expect(
      service.presign("user-1", {
        kind: "STORY_IMAGE",
        sizeBytes: 1024,
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "PRESIGN_FAILED" });
  });

  it("presigns a chat file upload up to 25MB with fileName", async () => {
    const result = await service.presign("user-1", {
      kind: "CHAT_FILE",
      sizeBytes: 20 * 1024 * 1024,
      mimeType: "application/pdf",
      fileName: "Tài liệu Báo Cáo.pdf",
      conversationId: "0193a2b1-0000-7000-8000-000000000001",
    });

    expect(result.uploadUrl).toBe("https://s3.example/signed");
    expect(result.objectKey).toContain("chat/0193a2b1-0000-7000-8000-000000000001/");
    expect(result.objectKey).toContain("T_i_li_u_B_o_C_o.pdf");
  });

  it("rejects chat uploads when the user is not an active conversation member", async () => {
    isParticipantMock.mockResolvedValue(false);
    await expect(
      service.presign("user-1", {
        kind: "CHAT_FILE",
        conversationId: "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b",
        sizeBytes: 1024,
        mimeType: "application/pdf",
        fileName: "notes.pdf",
      }),
    ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
    expect(presignPutMock).not.toHaveBeenCalled();
  });

  it("rejects chat files exceeding 25MB", async () => {
    await expect(
      service.presign("user-1", {
        kind: "CHAT_FILE",
        sizeBytes: 25 * 1024 * 1024 + 1,
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", params: { maxMb: "25" } });
  });

  it("rejects dangerous executable files in chat", async () => {
    await expect(
      service.presign("user-1", {
        kind: "CHAT_FILE",
        sizeBytes: 1024,
        mimeType: "application/octet-stream",
        fileName: "malware.exe",
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
  });

  it("uploads a file directly to storage via upload fallback", async () => {
    const result = await service.upload(
      "user-1",
      {
        buffer: Buffer.from("image-bytes"),
        size: 1024,
        mimetype: "image/png",
        originalname: "avatar.png",
      },
      "CHAT_IMAGE",
      "conv-123",
    );

    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(result.objectKey).toContain("chat/conv-123/");
    expect(result.objectKey).toContain("avatar.png");
  });

  it("fails closed with PRESIGN_FAILED when putObject errors in upload", async () => {
    putObjectMock.mockRejectedValueOnce(new StorageError("r2 failure"));

    await expect(
      service.upload(
        "user-1",
        {
          buffer: Buffer.from("image-bytes"),
          size: 1024,
          mimetype: "image/png",
          originalname: "avatar.png",
        },
        "CHAT_IMAGE",
        "conv-123",
      ),
    ).rejects.toMatchObject({ code: "PRESIGN_FAILED" });
  });
});
