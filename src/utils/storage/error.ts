import { SystemError } from "../errors/system.js";

// Infrastructure storage error — every S3 transport/config failure funnels
// here so critical callers can fail closed (HTTP 503). A missing object is
// NOT an error (HeadObject miss → null).
export class StorageError extends SystemError {
  constructor(message: string, detail?: unknown) {
    super("storage", message, detail === undefined ? undefined : { cause: detail });
    this.name = "StorageError";
  }
}
