export interface PresignGetParams {
  objectKey: string;
  fileName?: string;
  disposition?: "inline" | "attachment";
  mimeType?: string;
  expiresInSecs?: number;
}

export interface StorageService {
  presignPut(params: { objectKey: string; mimeType: string }): Promise<{ uploadUrl: string }>;
  presignGet(params: PresignGetParams): Promise<{ downloadUrl: string }>;
  headObject(objectKey: string): Promise<{ contentLength: number; contentType: string } | null>;
  // Batched delete; S3 reports missing keys as deleted, so re-running is idempotent.
  deleteObjects(objectKeys: string[]): Promise<{ deleted: string[]; failed: string[] }>;
  getBucket(): string;
}

export const STORAGE_SERVICE: unique symbol = Symbol("STORAGE_SERVICE");
