import { describe, expect, it } from "vitest";
import { callRoom, convRoom, userRoom } from "../../../../src/domain/realtime/rooms.js";

describe("realtime.rooms", () => {
  it("builds user, conv, and call room identifiers", () => {
    expect(userRoom("user-1")).toBe("user:user-1");
    expect(convRoom("conv-1")).toBe("conv:conv-1");
    expect(callRoom("call-1")).toBe("call:call-1");
  });
});
