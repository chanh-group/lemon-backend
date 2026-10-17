import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileController } from "../../../../src/domain/file/controller.js";
import { FileService } from "../../../../src/domain/file/service.js";
import type { PresignFileDto } from "../../../../src/domain/file/dto/request.js";
import type { PresignFileResponse } from "../../../../src/domain/file/dto/response.js";

describe("FileController", () => {
  let controller: FileController;
  let presignMock: Mock<(userId: string, dto: PresignFileDto) => Promise<PresignFileResponse>>;

  const dto: PresignFileDto = {
    kind: "STORY_IMAGE",
    sizeBytes: 1024,
    mimeType: "image/jpeg",
  };

  beforeEach(() => {
    presignMock = vi.fn().mockResolvedValue({
      uploadUrl: "https://s3.example/signed",
      objectKey: "stories/user-1/0193a2b1-0000-7000-8000-000000000001.jpg",
    });
    controller = new FileController({ presign: presignMock } as unknown as FileService);
  });

  it("returns the presign contract in the success envelope", async () => {
    const result = await controller.presignFile({ user: { id: "user-1" } }, dto);

    expect(presignMock).toHaveBeenCalledWith("user-1", dto);
    expect(result).toEqual({
      success: true,
      message: "OK",
      data: {
        uploadUrl: "https://s3.example/signed",
        objectKey: "stories/user-1/0193a2b1-0000-7000-8000-000000000001.jpg",
      },
    });
  });

  it("throws BusinessError UNAUTHORIZED when req.user is absent", async () => {
    await expect(controller.presignFile({}, dto)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
