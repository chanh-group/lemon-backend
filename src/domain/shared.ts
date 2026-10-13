export interface Pageable {
  cursor?: string;
  size: number;
}

export interface Page<T> {
  content: T[];
  cursor?: string;
  size: number;
}
