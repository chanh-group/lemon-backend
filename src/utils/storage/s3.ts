import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3_DELETE_BATCH_SIZE } from "../cache/constants.js";
import { StorageError } from "./error.js";
import type { PresignGetParams, StorageService } from "./store.js";

export type PresignerFn = (
  client: S3Client,
  command: PutObjectCommand | GetObjectCommand,
  options: { expiresIn: number; signableHeaders?: Set<string> },
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
    this.presigner = options.presigner ?? (getSignedUrl as unknown as PresignerFn);
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

  async presignGet(params: PresignGetParams): Promise<{ downloadUrl: string }> {
    try {
      const disposition = params.disposition ?? "inline";
      let contentDisposition: string | undefined;

      if (params.fileName) {
        // RFC 5987 / RFC 6266 encoding for international filenames
        const asciiFallback = params.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
        const utf8Encoded = encodeURIComponent(params.fileName);
        contentDisposition = `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
      } else {
        contentDisposition = disposition;
      }

      let contentType = params.mimeType;
      if (contentType && contentType.startsWith("text/plain") && !contentType.includes("charset")) {
        contentType = "text/plain; charset=utf-8";
      }

      const downloadUrl = await this.presigner(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          ...(contentDisposition && { ResponseContentDisposition: contentDisposition }),
          ...(contentType && { ResponseContentType: contentType }),
        }),
        {
          expiresIn: params.expiresInSecs ?? this.presignTtlSecs,
        },
      );
      return { downloadUrl };
    } catch (err) {
      throw new StorageError("Failed to presign download", err);
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

  async deleteObjects(objectKeys: string[]): Promise<{ deleted: string[]; failed: string[] }> {
    try {
      const deleted: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < objectKeys.length; i += S3_DELETE_BATCH_SIZE) {
        const chunk = objectKeys.slice(i, i + S3_DELETE_BATCH_SIZE);
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
          }),
        );
        for (const entry of result.Deleted ?? []) {
          if (entry.Key !== undefined) {
            deleted.push(entry.Key);
          }
        }
        for (const entry of result.Errors ?? []) {
          if (entry.Key !== undefined) {
            failed.push(entry.Key);
          }
        }
      }
      return { deleted, failed };
    } catch (err) {
      throw new StorageError("Failed to delete objects", err);
    }
  }

  getBucket(): string {
    return this.bucket;
  }
}
