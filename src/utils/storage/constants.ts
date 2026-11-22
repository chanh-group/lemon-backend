/** Upper bound for how long a cached presigned GET URL may be reused, in seconds. */
export const PRESIGN_CACHE_TTL_SECS = 3600;
/**
 * Freshness margin: a cached presigned URL is served only while at least this
 * much of its own validity remains, in seconds.
 */
export const PRESIGN_CACHE_MARGIN_SECS = 300;
/** Max entries kept in the in-process presigned-URL cache; oldest evicted first. */
export const PRESIGN_CACHE_MAX_ENTRIES = 1000;
/** Dev/test fallback for API_PUBLIC_URL (public origin serving presigned URLs). */
export const DEFAULT_API_PUBLIC_URL = "http://localhost:3000";
