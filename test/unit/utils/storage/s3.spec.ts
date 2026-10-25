import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi, type Mock } from "vitest";
import { S3_DELETE_BATCH_SIZE } from "../../../../src/utils/cache/constants.js";
import { StorageError } from "../../../../src/utils/storage/error.js";
import { S3StorageService, type PresignerFn } from "../../../../src/utils/storage/s3.js";

function createStorage(
  send: ReturnType<typeof vi.fn>,
  signer: Mock<PresignerFn> = vi.fn<PresignerFn>(),
) {
  const client = { send } as unknown as S3Client;
  const service = new S3StorageService({
    client,
    bucket: "test-bucket",
    presignTtlSecs: 300,
    presigner: signer,
  });
  return { service, signer };
}

describe("S3StorageService", () => {
  it("presigns a PUT with the exact content type and TTL", async () => {
    const send = vi.fn();
    const signer = vi.fn<PresignerFn>().mockResolvedValue("https://s3.example/signed");
    const { service } = createStorage(send, signer);

    const result = await service.presignPut({
      objectKey: "stories/u1/abc.jpg",
      mimeType: "image/jpeg",
    });

    expect(result.uploadUrl).toBe("https://s3.example/signed");
    const [client, command, options] = signer.mock.calls[0];
    expect(client).toBeDefined();
    expect(command).toBeInstanceOf(PutObjectCommand);
    const putCmd = command as PutObjectCommand;
    expect(putCmd.input.Bucket).toBe("test-bucket");
    expect(putCmd.input.Key).toBe("stories/u1/abc.jpg");
    expect(putCmd.input.ContentType).toBe("image/jpeg");
    expect(options.expiresIn).toBe(300);
    expect(options.signableHeaders).toContain("content-type");
    expect(send).not.toHaveBeenCalled();
  });

  it("wraps presigner failures in StorageError", async () => {
    const signer = vi.fn<PresignerFn>().mockRejectedValue(new Error("no creds"));
    const { service } = createStorage(vi.fn(), signer);

    await expect(
      service.presignPut({ objectKey: "k", mimeType: "image/jpeg" }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("uploads object successfully via putObject", async () => {
    const send = vi.fn().mockResolvedValue({});
    const { service } = createStorage(send);
    const body = Buffer.from("hello world");

    await service.putObject({ objectKey: "chat/u1/file.txt", body, mimeType: "text/plain" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "chat/u1/file.txt",
      ContentType: "text/plain",
      Body: body,
    });
  });

  it("wraps putObject errors in StorageError", async () => {
    const send = vi.fn().mockRejectedValue(new Error("R2 down"));
    const { service } = createStorage(send);

    await expect(
      service.putObject({ objectKey: "k", body: Buffer.from("test"), mimeType: "text/plain" }),
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

  it("deleteObjects returns an empty result without calling S3", async () => {
    const send = vi.fn();
    const { service } = createStorage(send);
    await expect(service.deleteObjects([])).resolves.toEqual({ deleted: [], failed: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("deleteObjects sends one quiet batch command with the configured bucket", async () => {
    const send = vi.fn().mockResolvedValue({ Deleted: [{ Key: "a" }, { Key: "b" }] });
    const { service } = createStorage(send);
    await expect(service.deleteObjects(["a", "b"])).resolves.toEqual({
      deleted: ["a", "b"],
      failed: [],
    });
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectsCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Delete: { Quiet: false, Objects: [{ Key: "a" }, { Key: "b" }] },
    });
  });

  it("deleteObjects sends a single batch at exactly S3_DELETE_BATCH_SIZE", async () => {
    const send = vi.fn().mockResolvedValue({ Deleted: [] });
    const { service } = createStorage(send);
    const keys = Array.from({ length: S3_DELETE_BATCH_SIZE }, (_, i) => `k${i}`);
    await service.deleteObjects(keys);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input.Delete.Objects).toHaveLength(S3_DELETE_BATCH_SIZE);
  });

  it("deleteObjects chunks beyond S3_DELETE_BATCH_SIZE", async () => {
    const send = vi.fn().mockResolvedValue({ Deleted: [] });
    const { service } = createStorage(send);
    const keys = Array.from({ length: S3_DELETE_BATCH_SIZE + 1 }, (_, i) => `k${i}`);
    await service.deleteObjects(keys);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].input.Delete.Objects).toHaveLength(S3_DELETE_BATCH_SIZE);
    expect(send.mock.calls[1][0].input.Delete.Objects).toHaveLength(1);
  });

  it("deleteObjects reports per-key errors as failed", async () => {
    const send = vi.fn().mockResolvedValue({
      Deleted: [{ Key: "a" }],
      Errors: [{ Key: "b", Code: "AccessDenied" }],
    });
    const { service } = createStorage(send);
    await expect(service.deleteObjects(["a", "b"])).resolves.toEqual({
      deleted: ["a"],
      failed: ["b"],
    });
  });

  it("wraps delete transport failures in StorageError", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    const { service } = createStorage(send);
    await expect(service.deleteObjects(["a"])).rejects.toBeInstanceOf(StorageError);
  });

  it("exposes the configured bucket", () => {
    const { service } = createStorage(vi.fn());
    expect(service.getBucket()).toBe("test-bucket");
  });

  it("real signing with WHEN_REQUIRED produces a checksum-free PUT URL (socket-free)", async () => {
    const client = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    const service = new S3StorageService({ client, bucket: "test-bucket", presignTtlSecs: 300 });

    const { uploadUrl } = await service.presignPut({
      objectKey: "stories/u1/abc.jpg",
      mimeType: "image/jpeg",
    });

    expect(uploadUrl).not.toContain("x-amz-checksum-crc32");
    expect(uploadUrl).not.toContain("x-amz-sdk-checksum-algorithm");
    expect(uploadUrl).toContain("X-Amz-SignedHeaders=content-type");
  });

  it("control: an SDK-default client embeds the empty-body checksum params", async () => {
    const client = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    });
    const service = new S3StorageService({ client, bucket: "test-bucket", presignTtlSecs: 300 });

    const { uploadUrl } = await service.presignPut({
      objectKey: "stories/u1/abc.jpg",
      mimeType: "image/jpeg",
    });

    expect(uploadUrl).toContain("x-amz-checksum-crc32");
  });

  it("presigns a GET for inline preview with UTF-8 content-type for text/plain", async () => {
    const send = vi.fn();
    const signer = vi.fn<PresignerFn>().mockResolvedValue("https://s3.example/get-signed");
    const { service } = createStorage(send, signer);

    const result = await service.presignGet({
      objectKey: "chat/c1/doc.txt",
      fileName: "Tài liệu tiếng Việt.txt",
      disposition: "inline",
      mimeType: "text/plain",
    });

    expect(result.downloadUrl).toBe("https://s3.example/get-signed");
    const [client, command, options] = signer.mock.calls[0];
    expect(client).toBeDefined();
    expect(command).toBeInstanceOf(GetObjectCommand);
    const getCmd = command as GetObjectCommand;
    expect(getCmd.input.Bucket).toBe("test-bucket");
    expect(getCmd.input.Key).toBe("chat/c1/doc.txt");
    expect(getCmd.input.ResponseContentType).toBe("text/plain; charset=utf-8");
    expect(getCmd.input.ResponseContentDisposition).toContain("inline;");
    expect(getCmd.input.ResponseContentDisposition).toContain("filename*=UTF-8''");
    expect(options.expiresIn).toBe(300);
  });

  it("presigns a GET for download attachment with encoded filename", async () => {
    const send = vi.fn();
    const signer = vi.fn<PresignerFn>().mockResolvedValue("https://s3.example/download-signed");
    const { service } = createStorage(send, signer);

    const result = await service.presignGet({
      objectKey: "chat/c1/report.pdf",
      fileName: "Báo cáo Q4.pdf",
      disposition: "attachment",
      mimeType: "application/pdf",
      expiresInSecs: 3600,
    });

    expect(result.downloadUrl).toBe("https://s3.example/download-signed");
    const [, command, options] = signer.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    const downloadCmd = command as GetObjectCommand;
    expect(downloadCmd.input.ResponseContentDisposition).toContain("attachment;");
    expect(downloadCmd.input.ResponseContentDisposition).toContain("filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20Q4.pdf");
    expect(downloadCmd.input.ResponseContentType).toBe("application/pdf");
    expect(options.expiresIn).toBe(3600);
  });
});
