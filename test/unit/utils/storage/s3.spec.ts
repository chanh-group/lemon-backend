import { HeadObjectCommand, NotFound, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { StorageError } from "../../../../src/utils/storage/error.js";
import { S3StorageService } from "../../../../src/utils/storage/s3.js";

function createStorage(send: ReturnType<typeof vi.fn>, signer = vi.fn()) {
  const client = { send } as unknown as S3Client;
  const service = new S3StorageService({
    client,
    bucket: "test-bucket",
    presignTtlSecs: 300,
    presigner: signer as never,
  });
  return { service, signer };
}

describe("S3StorageService", () => {
  it("presigns a PUT with the exact content type and TTL", async () => {
    const send = vi.fn();
    const signer = vi.fn().mockResolvedValue("https://s3.example/signed");
    const { service } = createStorage(send, signer);

    const result = await service.presignPut({
      objectKey: "stories/u1/abc.jpg",
      mimeType: "image/jpeg",
    });

    expect(result.uploadUrl).toBe("https://s3.example/signed");
    const [client, command, options] = signer.mock.calls[0];
    expect(client).toBeDefined();
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.Key).toBe("stories/u1/abc.jpg");
    expect(command.input.ContentType).toBe("image/jpeg");
    expect(options.expiresIn).toBe(300);
    expect(options.signableHeaders).toContain("content-type");
    expect(send).not.toHaveBeenCalled();
  });

  it("wraps presigner failures in StorageError", async () => {
    const signer = vi.fn().mockRejectedValue(new Error("no creds"));
    const { service } = createStorage(vi.fn(), signer);

    await expect(
      service.presignPut({ objectKey: "k", mimeType: "image/jpeg" }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("returns head metadata on success", async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 1234, ContentType: "image/png" });
    const { service } = createStorage(send);

    await expect(service.headObject("stories/u1/a.png")).resolves.toEqual({
      contentLength: 1234,
      contentType: "image/png",
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "stories/u1/a.png",
    });
  });

  it("returns null when the object does not exist (404/NotFound)", async () => {
    const notFound = new NotFound({ message: "nope", $metadata: { httpStatusCode: 404 } });
    const send = vi.fn().mockRejectedValue(notFound);
    const { service } = createStorage(send);

    await expect(service.headObject("missing")).resolves.toBeNull();
  });

  it("wraps other head failures in StorageError with the cause", async () => {
    const cause = new Error("network down");
    const send = vi.fn().mockRejectedValue(cause);
    const { service } = createStorage(send);

    await expect(service.headObject("k")).rejects.toMatchObject({
      name: "StorageError",
      kind: "storage",
      cause,
    });
  });

  it("exposes the configured bucket", () => {
    const { service } = createStorage(vi.fn());
    expect(service.getBucket()).toBe("test-bucket");
  });
});
