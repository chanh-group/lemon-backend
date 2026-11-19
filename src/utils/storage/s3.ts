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
import {
  PRESIGN_CACHE_MARGIN_SECS,
  PRESIGN_CACHE_MAX_ENTRIES,
  PRESIGN_CACHE_TTL_SECS,
} from "./constants.js";
import { StorageError } from "./error.js";
import type { PresignGetParams, StorageService } from "./store.js";

/** Cached presigned GET URL plus its reuse deadline (epoch millis). */
interface CachedPresign {
  downloadUrl: string;
  expiresAt: number;
}

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
  private readonly presignCache = new Map<string, CachedPresign>();

  constructor(options: S3StorageOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.presignTtlSecs = options.presignTtlSecs;
    this.presigner = options.presigner ?? (getSignedUrl as unknown as PresignerFn);
  }

  async presignPut(params: {
    objectKey: string;
    mimeType: string;
    contentLength?: number;
  }): Promise<{ uploadUrl: string }> {
    try {
      const uploadUrl = await this.presigner(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          ContentType: params.mimeType,
          ...(params.contentLength !== undefined && { ContentLength: params.contentLength }),
        }),
        {
          expiresIn: this.presignTtlSecs,
          signableHeaders: new Set(
            params.contentLength === undefined
              ? ["content-type"]
              : ["content-length", "content-type"],
          ),
        },
      );
      return { uploadUrl };
    } catch (err) {
      throw new StorageError("Failed to presign upload", err);
    }
  }

  async putObject(params: {
    objectKey: string;
    body: Buffer | Uint8Array;
    mimeType: string;
  }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.objectKey,
          Body: params.body,
          ContentType: params.mimeType,
        }),
      );
    } catch (err) {
      throw new StorageError("Failed to upload object", err);
    }
  }

  async getObject(
    objectKey: string,
  ): Promise<{ body: Uint8Array; contentType: string; contentLength: number } | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      if (!response.Body) return null;
      const body = await response.Body.transformToByteArray();
      return {
        body,
        contentType: response.ContentType ?? "application/octet-stream",
        contentLength: response.ContentLength ?? body.byteLength,
      };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string })?.name === "NoSuchKey") {
        return null;
      }
      throw new StorageError("Failed to get object", err);
    }
  }

  async presignGet(params: PresignGetParams): Promise<{ downloadUrl: string }> {
    const disposition = params.disposition ?? "inline";
    const expiresInSecs = params.expiresInSecs ?? this.presignTtlSecs;
    const cacheKey = this.presignGetCacheKey(params, disposition, expiresInSecs);
    const cached = this.presignCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) return { downloadUrl: cached.downloadUrl };
      this.presignCache.delete(cacheKey);
    }

    try {
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
          expiresIn: expiresInSecs,
        },
      );
      this.rememberPresignGet(cacheKey, downloadUrl, expiresInSecs);
      return { downloadUrl };
    } catch (err) {
      throw new StorageError("Failed to presign download", err);
    }
  }

  /** Stable cache key over the effective presign parameters. */
  private presignGetCacheKey(
    params: PresignGetParams,
    disposition: "inline" | "attachment",
    expiresInSecs: number,
  ): string {
    return JSON.stringify([
      params.objectKey,
      params.fileName ?? null,
      disposition,
      params.mimeType ?? null,
      expiresInSecs,
    ]);
  }

  /**
   * A cached URL stays valid until its own expiry even if credentials rotate,
   * so the cache is purely an optimization: only URLs that keep at least
   * PRESIGN_CACHE_MARGIN_SECS of remaining validity are retained, and entries
   * past PRESIGN_CACHE_MAX_ENTRIES are evicted oldest-first.
   */
  private rememberPresignGet(cacheKey: string, downloadUrl: string, expiresInSecs: number): void {
    const ttlSecs = Math.min(PRESIGN_CACHE_TTL_SECS, expiresInSecs - PRESIGN_CACHE_MARGIN_SECS);
    if (ttlSecs <= 0) return;
    while (this.presignCache.size >= PRESIGN_CACHE_MAX_ENTRIES) {
      const oldestKey = this.presignCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.presignCache.delete(oldestKey);
    }
    this.presignCache.set(cacheKey, { downloadUrl, expiresAt: Date.now() + ttlSecs * 1000 });
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
