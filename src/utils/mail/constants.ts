export const MAIL_QUEUE_MAX_SIZE = 128;
export const MAIL_QUEUE_CONCURRENCY = 1;
export const MAIL_RETRY_BACKOFFS_MS = [1000, 5000] as const;
export const MAIL_RETRY_COUNT = MAIL_RETRY_BACKOFFS_MS.length;
export const MAIL_QUEUE_DRAIN_TIMEOUT_MS = 5000;
