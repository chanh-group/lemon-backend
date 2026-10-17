import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageError } from "./error.js";
import type { StorageService } from "./store.js";

export type PresignerFn = (
  client: S3Client,
  command: PutObjectCommand,
  options: { expiresIn: number; signableHeaders: Set<string> },
) => Promise<string>;

export interface S3StorageOptions {
  client: S3Client;
  bucket: string;
  presignTtlSecs: number;
  presigner?: PresignerFn;
}

export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignTtlSecs: number;
  private readonly presigner: PresignerFn;

  constructor(options: S3StorageOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.presignTtlSecs = options.presignTtlSecs;
    this.presigner = options.presigner ?? getSignedUrl;
  }

  async presignPut(params: {
    objectKey: string;
    mimeType: string;
  }): Promise<{ uploadUrl: string }> {
    try {
      const uploadUrl = await this.presigner(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          ContentType: params.mimeType,
        }),
        {
          expiresIn: this.presignTtlSecs,
          signableHeaders: new Set(["content-type"]),
        },
      );
      return { uploadUrl };
    } catch (err) {
      throw new StorageError("Failed to presign upload", err);
    }
  }

  async headObject(
    objectKey: string,
  ): Promise<{ contentLength: number; contentType: string } | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        contentLength: head.ContentLength ?? 0,
        contentType: head.ContentType ?? "",
      };
    } catch (err) {
      if (err instanceof NotFound) {
        return null;
      }
      throw new StorageError("Failed to inspect object", err);
    }
  }

  getBucket(): string {
    return this.bucket;
  }
}
