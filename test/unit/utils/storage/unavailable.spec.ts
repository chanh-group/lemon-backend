import { describe, expect, it } from "vitest";
import { UnavailableStorageService } from "../../../../src/utils/storage/unavailable.js";
import { StorageError } from "../../../../src/utils/storage/error.js";

describe("UnavailableStorageService", () => {
  const storage = new UnavailableStorageService();

  it("throws StorageError on presignPut", async () => {
    await expect(storage.presignPut({ objectKey: "k", mimeType: "image/jpeg" })).rejects.toThrow(
      StorageError,
    );
  });

  it("throws StorageError on headObject", async () => {
    await expect(storage.headObject("k")).rejects.toThrow(StorageError);
  });

  it("throws StorageError on deleteObjects", async () => {
    await expect(storage.deleteObjects(["k"])).rejects.toThrow(StorageError);
  });

  it("throws StorageError on getBucket (no bucket exists)", () => {
    expect(() => storage.getBucket()).toThrow(StorageError);
  });
});
