export interface StorageService {
  presignPut(params: { objectKey: string; mimeType: string }): Promise<{ uploadUrl: string }>;
  headObject(objectKey: string): Promise<{ contentLength: number; contentType: string } | null>;
  getBucket(): string;
}

export const STORAGE_SERVICE: unique symbol = Symbol("STORAGE_SERVICE");
