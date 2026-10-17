import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStorageConfig } from "../../../src/configs/storage.js";

const COMPLETE_ENV = {
  APP_ENV: "development",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("resolveStorageConfig", () => {
  it("returns s3 mode with defaults in dev when fully configured", () => {
    expect(resolveStorageConfig(COMPLETE_ENV)).toEqual({
      mode: "s3",
      bucket: "b",
      region: "us-east-1",
      endpoint: undefined,
      forcePathStyle: false,
      accessKeyId: "key",
      secretAccessKey: "secret",
      presignTtlSecs: 300,
    });
  });

  it("returns unavailable in dev when config is missing", () => {
    expect(resolveStorageConfig({ APP_ENV: "development" })).toEqual({ mode: "unavailable" });
    expect(resolveStorageConfig({ APP_ENV: "development", S3_BUCKET: "b" })).toEqual({
      mode: "unavailable",
    });
  });

  it("dev defaults the bucket to lemon-stories when creds are present", () => {
    expect(
      resolveStorageConfig({
        APP_ENV: "development",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
      }),
    ).toMatchObject({ mode: "s3", bucket: "lemon-stories" });
  });

  it("throws at boot in production when required config is missing", () => {
    expect(() => resolveStorageConfig({ APP_ENV: "production" })).toThrow(
      "Environment variable S3_BUCKET is not set",
    );
    expect(() => resolveStorageConfig({ APP_ENV: "production", S3_BUCKET: "b" })).toThrow(
      "Environment variable S3_ACCESS_KEY_ID is not set",
    );
    expect(() =>
      resolveStorageConfig({
        APP_ENV: "production",
        S3_BUCKET: "b",
        S3_ACCESS_KEY_ID: "key",
      }),
    ).toThrow("Environment variable S3_SECRET_ACCESS_KEY is not set");
  });

  it("applies optional overrides (endpoint, region, path style, TTL)", () => {
    expect(
      resolveStorageConfig({
        ...COMPLETE_ENV,
        S3_REGION: "auto",
        S3_ENDPOINT: "https://r2.example",
        S3_FORCE_PATH_STYLE: "true",
        S3_PRESIGN_TTL_SECS: "600",
      }),
    ).toMatchObject({
      mode: "s3",
      region: "auto",
      endpoint: "https://r2.example",
      forcePathStyle: true,
      presignTtlSecs: 600,
    });
  });
});

describe("StorageModule", () => {
  beforeEach(() => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.APP_ENV;
    vi.resetModules();
  });

  it("dev without S3 env provides UnavailableStorageService", async () => {
    const { Test } = await import("@nestjs/testing");
    const { StorageModule } = await import("../../../src/configs/storage.js");
    const { STORAGE_SERVICE } = await import("../../../src/utils/storage/store.js");
    const { UnavailableStorageService } = await import("../../../src/utils/storage/unavailable.js");

    const mod = await Test.createTestingModule({ imports: [StorageModule] }).compile();
    expect(mod.get(STORAGE_SERVICE)).toBeInstanceOf(UnavailableStorageService);
    await mod.close();
  }, 15000);

  it("fully configured env provides S3StorageService without loading AWS at boot", async () => {
    process.env.S3_ACCESS_KEY_ID = "k";
    process.env.S3_SECRET_ACCESS_KEY = "s";
    const { Test } = await import("@nestjs/testing");
    const { StorageModule } = await import("../../../src/configs/storage.js");
    const { STORAGE_SERVICE } = await import("../../../src/utils/storage/store.js");
    const { S3StorageService } = await import("../../../src/utils/storage/s3.js");

    const mod = await Test.createTestingModule({ imports: [StorageModule] }).compile();
    expect(mod.get(STORAGE_SERVICE)).toBeInstanceOf(S3StorageService);
    await mod.close();
  }, 15000);
});
