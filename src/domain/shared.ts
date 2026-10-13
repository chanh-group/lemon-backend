export type PaginatedResult<T> = {
  items: T[];
  nextCursor?: string | null;
  hasMore: boolean;
};

export type BaseTimestamp = {
  createdAt: Date;
  updatedAt: Date;
};

