import { describe, expect, it } from "vitest";
import { SYSTEM_STATUS, SystemError } from "../../../../src/utils/errors/system.js";
import { errorCode, errorStatus } from "../../../../src/utils/errors/app.js";

describe("SystemError", () => {
  it("maps infrastructure kinds to 503 and internal kinds to 500", () => {
    expect(SYSTEM_STATUS.cache).toBe(503);
    expect(SYSTEM_STATUS.storage).toBe(503);
    expect(SYSTEM_STATUS.unavailable).toBe(503);
    expect(SYSTEM_STATUS.database).toBe(500);
    expect(SYSTEM_STATUS.internal).toBe(500);
  });

  it("resolves to a generic code, never the original message", () => {
    const cache = new SystemError("cache", "cache GET failed");
    expect(errorCode(cache)).toBe("SERVICE_UNAVAILABLE");
    expect(errorStatus(cache)).toBe(503);

    const db = new SystemError("database", "column does not exist");
    expect(errorCode(db)).toBe("INTERNAL_SERVER_ERROR");
    expect(errorStatus(db)).toBe(500);
  });

  it("preserves the cause for logging", () => {
    const cause = new Error("redis down");
    const err = new SystemError("cache", "cache GET failed", { cause });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("SystemError");
  });
});
