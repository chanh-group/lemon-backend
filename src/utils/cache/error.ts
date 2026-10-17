import { SystemError } from "../errors/system.js";

// Infrastructure cache error — every Redis transport failure funnels here so
// critical callers can fail closed (HTTP 503). Misses and corrupt entries are
// NOT errors (miss → null, corrupt → delete + null). Ported from Rust `error.rs`.
export class CacheError extends SystemError {
  readonly op: string;

  constructor(op: string, detail?: unknown) {
    super("cache", `cache ${op} failed`, detail === undefined ? undefined : { cause: detail });
    this.name = "CacheError";
    this.op = op;
  }
}
