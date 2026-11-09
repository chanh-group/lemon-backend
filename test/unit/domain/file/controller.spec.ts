import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileController } from "../../../../src/domain/file/controller.js";
import { FileService } from "../../../../src/domain/file/service.js";
import { MemoryRateLimiter, RATE_LIMITER } from "../../../../src/middleware/ratelimit.js";
import type { PresignFileDto } from "../../../../src/domain/file/dto/request.js";
import type { PresignFileResponse } from "../../../../src/domain/file/dto/response.js";
import { UserService } from "../../../../src/domain/user/service.js";
import { standardSchemaPipe } from "../../../../src/utils/validation.js";

describe("FileController", () => {
  let controller: FileController;
  let presignMock: Mock<(userId: string, dto: PresignFileDto) => Promise<PresignFileResponse>>;

  const dto: PresignFileDto = {
    kind: "STORY_IMAGE",
    sizeBytes: 1024,
    mimeType: "image/jpeg",
  };

  const mockPresignResponse: PresignFileResponse = {
    uploadUrl: "https://s3.example/signed",
    objectKey: "stories/user-1/0193a2b1-0000-7000-8000-000000000001.jpg",
  };

  beforeEach(() => {
    presignMock = vi.fn().mockResolvedValue(mockPresignResponse);
    controller = new FileController(
      { presign: presignMock } as unknown as FileService,
      new MemoryRateLimiter(),
      { findById: vi.fn() } as unknown as UserService,
    );
  });

  it("returns the presign contract in the success envelope", async () => {
    const result = await controller.presignFile({ user: { id: "user-1" } }, dto);

    expect(presignMock).toHaveBeenCalledWith("user-1", dto);
    expect(result).toEqual({
      success: true,
      message: "OK",
      data: mockPresignResponse,
    });
  });

  it("redirects the stable public avatar URL to a fresh signed storage URL", async () => {
    const userId = "0193a2b1-0000-7000-8000-000000000001";
    const fileName = "0193a2b1-7c4d-7e8f-9a0b-1c2d3e4f5a6b.png";
    const downloadUrl = "https://s3.example/signed-avatar";
    const getAvatarDownloadUrl = vi.fn().mockResolvedValue(downloadUrl);
    const findById = vi.fn().mockResolvedValue({ avatarUrl: "https://api.example.com/avatar" });
    const redirect = vi.fn();
    const c = new FileController(
      { getAvatarDownloadUrl } as unknown as FileService,
      new MemoryRateLimiter(),
      { findById } as unknown as UserService,
    );
    const response = { redirect } as unknown as Response;

    await c.getAvatar(userId, fileName, response);

    expect(findById).toHaveBeenCalledWith(userId);
    expect(getAvatarDownloadUrl).toHaveBeenCalledWith(
      userId,
      fileName,
      "https://api.example.com/avatar",
    );
    expect(redirect).toHaveBeenCalledWith(302, downloadUrl);
  });

  it("handles uploadFile fallback endpoint", async () => {
    const uploadMock = vi.fn().mockResolvedValue({
      objectKey: "chat/0193a2b1-0000-7000-8000-000000000010/user-1/file.png",
    });
    const c = new FileController(
      { presign: presignMock, upload: uploadMock } as unknown as FileService,
      new MemoryRateLimiter(),
      { findById: vi.fn() } as unknown as UserService,
    );

    const result = await c.uploadFile(
      { user: { id: "user-1" } },
      {
        buffer: Buffer.from("data"),
        size: 4,
        mimetype: "image/png",
        originalname: "file.png",
      },
      "CHAT_IMAGE",
      "0193a2b1-0000-7000-8000-000000000010",
    );

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: "OK",
      data: { objectKey: "chat/0193a2b1-0000-7000-8000-000000000010/user-1/file.png" },
    });
  });

  it("throws BAD_REQUEST in uploadFile when file is missing", async () => {
    await expect(
      controller.uploadFile({ user: { id: "user-1" } }, undefined, "CHAT_IMAGE"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws BusinessError UNAUTHORIZED when req.user is absent", async () => {
    await expect(controller.presignFile({}, dto)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  describe("HTTP request path", () => {
    let app: INestApplication<App>;
    let httpPresign: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      httpPresign = vi.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [FileController],
        providers: [
          {
            provide: FileService,
            useValue: {
              presign: httpPresign,
              getAvatarDownloadUrl: vi.fn(),
            } as unknown as FileService,
          },
          { provide: UserService, useValue: { findById: vi.fn() } },
          { provide: RATE_LIMITER, useValue: new MemoryRateLimiter() },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use((req: Request, _res: Response, next: () => void) => {
        (req as Request & { user?: { id: string } }).user = { id: "user-1" };
        next();
      });
      app.useGlobalPipes(standardSchemaPipe());
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("keeps the OK message for presign even with accept-language: en", async () => {
      httpPresign.mockResolvedValueOnce(mockPresignResponse);

      const response = await request(app.getHttpServer())
        .post("/files/presign")
        .set("accept-language", "en")
        .send({ kind: "STORY_IMAGE", sizeBytes: 1024, mimeType: "image/jpeg" })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: "OK",
        data: mockPresignResponse,
      });
    });
  });
});
