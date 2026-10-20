import { SetMetadata } from "@nestjs/common";

export const SKIP_REDIS_READINESS_KEY = "skipRedisReadiness";
export const SkipRedisReadiness = () => SetMetadata(SKIP_REDIS_READINESS_KEY, true);
