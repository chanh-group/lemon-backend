// Global storage wiring — mirror of `CacheModule`: env-driven provider, token
// injection, dynamic import so an unconfigured dev boot never loads the SDK.
// Prod fails fast (`Environment variable X is not set`); dev/test get a
// fail-closed no-op instead.
import { Global, Logger, Module } from "@nestjs/common";
import { S3_PRESIGN_TTL_SECS, STORY_DEFAULT_BUCKET } from "../utils/cache/constants.js";
import { S3StorageService } from "../utils/storage/s3.js";
import { STORAGE_SERVICE } from "../utils/storage/store.js";
import { UnavailableStorageService } from "../utils/storage/unavailable.js";

const logger = new Logger("Storage");

type StorageEnv = Record<string, string | undefined>;

export type StorageConfig =
  | {
      mode: "s3";
      bucket: string;
      region: string;
      endpoint: string | undefined;
      forcePathStyle: boolean;
      accessKeyId: string;
      secretAccessKey: string;
      presignTtlSecs: number;
    }
  | { mode: "unavailable" };

function required(env: StorageEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

export function resolveStorageConfig(env: StorageEnv): StorageConfig {
  const isProduction = (env.APP_ENV ?? "development") === "production";

  // Prod: fail fast on missing config. Dev/test: default bucket, no creds → unavailable.
  const bucket = isProduction
    ? required(env, "S3_BUCKET")
    : (env.S3_BUCKET ?? STORY_DEFAULT_BUCKET);
  const accessKeyId = isProduction ? required(env, "S3_ACCESS_KEY_ID") : env.S3_ACCESS_KEY_ID;
  const secretAccessKey = isProduction
    ? required(env, "S3_SECRET_ACCESS_KEY")
    : env.S3_SECRET_ACCESS_KEY;

  const missingCreds =
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === undefined ||
    secretAccessKey === "";
  if (missingCreds) {
    return { mode: "unavailable" };
  }

  return {
    mode: "s3",
    bucket,
    region: env.S3_REGION ?? "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId,
    secretAccessKey,
    presignTtlSecs: Number(env.S3_PRESIGN_TTL_SECS ?? S3_PRESIGN_TTL_SECS),
  };
}

async function createS3Storage(config: Extract<StorageConfig, { mode: "s3" }>) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  logger.log(`S3 storage enabled (bucket=${config.bucket}, region=${config.region})`);
  return new S3StorageService({
    client,
    bucket: config.bucket,
    presignTtlSecs: config.presignTtlSecs,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: async () => {
        const config = resolveStorageConfig(process.env);
        if (config.mode === "unavailable") {
          logger.warn("S3 storage not configured — presign/verify will fail closed (503)");
          return new UnavailableStorageService();
        }
        return createS3Storage(config);
      },
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
