import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileService } from "../../../../src/domain/file/service.js";
import type { StorageService } from "../../../../src/utils/storage/store.js";
import { StorageError } from "../../../../src/utils/storage/error.js";

describe("FileService", () => {
  let service: FileService;
  let presignPutMock: Mock<
    (params: { objectKey: string; mimeType: string }) => Promise<{ uploadUrl: string }>
  >;

  const storage = () =>
    ({
      presignPut: presignPutMock,
    }) as unknown as StorageService;

  beforeEach(() => {
    presignPutMock = vi.fn().mockResolvedValue({ uploadUrl: "https://s3.example/signed" });
    service = new FileService(storage());
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

  it("rejects oversized uploads with FILE_TOO_LARGE carrying maxMb", async () => {
    await expect(
      service.presign("user-1", {
        kind: "STORY_IMAGE",
        sizeBytes: 10 * 1024 * 1024 + 1,
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", params: { maxMb: "10" } });
  });

  it("rejects video above the video cap", async () => {
    await expect(
      service.presign("user-1", {
        kind: "STORY_VIDEO",
        sizeBytes: 50 * 1024 * 1024 + 1,
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", params: { maxMb: "50" } });
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
});
