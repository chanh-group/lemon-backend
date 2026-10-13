// Infrastructure cache error — every Redis transport failure funnels here so
// critical callers can fail closed (HTTP 503). Misses and corrupt entries are
// NOT errors (miss → null, corrupt → delete + null). Ported from Rust `error.rs`.
export class CacheError extends Error {
  readonly op: string;

  constructor(op: string, detail?: unknown) {
    super(`cache ${op} failed`);
    this.name = "CacheError";
    this.op = op;
    if (detail !== undefined) {
      (this as { cause?: unknown }).cause = detail;
    }
  }
}
