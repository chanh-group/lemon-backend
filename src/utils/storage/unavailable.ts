import { StorageError } from "./error.js";
import type { PresignGetParams, StorageService } from "./store.js";

// Dev/test without S3 configuration: boot stays safe; every call fails closed.
export class UnavailableStorageService implements StorageService {
  async presignPut(_params: {
    objectKey: string;
    mimeType: string;
  }): Promise<{ uploadUrl: string }> {
    throw new StorageError("storage is not configured");
  }

  async presignGet(_params: PresignGetParams): Promise<{ downloadUrl: string }> {
    throw new StorageError("storage is not configured");
  }

  async headObject(
    _objectKey: string,
  ): Promise<{ contentLength: number; contentType: string } | null> {
    throw new StorageError("storage is not configured");
  }

  async deleteObjects(_objectKeys: string[]): Promise<{ deleted: string[]; failed: string[] }> {
    throw new StorageError("storage is not configured");
  }

  getBucket(): string {
    throw new StorageError("storage is not configured");
  }
}
