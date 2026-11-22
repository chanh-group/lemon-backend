export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 100;
export const USER_BIO_MAX_LENGTH = 500;

export const USER_SEARCH_MIN_LENGTH = 2;
export const USER_SEARCH_MAX_LENGTH = 64;

// Search result ranking (lower = better): 0 exact username, 1 username prefix,
// 2 full-name prefix, 3 fallback. Cursor accepts ranks up to the worst one.
export const USER_SEARCH_RANK_FULL_NAME_PREFIX = 2;
export const USER_SEARCH_RANK_FALLBACK = 3;
export const USER_SEARCH_RANK_MAX = USER_SEARCH_RANK_FALLBACK;
