import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import type { App } from "supertest/types.js";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FileController } from "../../../../src/domain/file/controller.js";
import { FileService } from "../../../../src/domain/file/service.js";
import type { PresignFileDto } from "../../../../src/domain/file/dto/request.js";
import type { PresignFileResponse } from "../../../../src/domain/file/dto/response.js";
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
    controller = new FileController({ presign: presignMock } as unknown as FileService);
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
            useValue: { presign: httpPresign } as unknown as FileService,
          },
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
