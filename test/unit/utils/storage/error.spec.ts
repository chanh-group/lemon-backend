import { describe, expect, it } from "vitest";
import { StorageError } from "../../../../src/utils/storage/error.js";
import { errorCode, errorStatus } from "../../../../src/utils/errors/app.js";
import { SystemError } from "../../../../src/utils/errors/system.js";

describe("StorageError", () => {
  it("is a SystemError of kind storage that maps to 503 SERVICE_UNAVAILABLE", () => {
    const err = new StorageError("presign failed", new Error("network"));
    expect(err).toBeInstanceOf(SystemError);
    expect(err.kind).toBe("storage");
    expect(errorStatus(err)).toBe(503);
    expect(errorCode(err)).toBe("SERVICE_UNAVAILABLE");
    expect(err.name).toBe("StorageError");
  });

  it("preserves the cause when a detail is given", () => {
    const cause = new Error("timeout");
    expect(new StorageError("head failed", cause).cause).toBe(cause);
    expect(new StorageError("head failed").cause).toBeUndefined();
  });
});
