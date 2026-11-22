import { describe, expect, it } from "vitest";
import {
  countMessageBodyCodePoints,
  isMessageBodyWithinLimit,
} from "../../../../src/domain/message/body-length.js";

describe("message body length", () => {
  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(countMessageBodyCodePoints("a😀e\u0301\n")).toBe(5);
    expect("a😀e\u0301\n".length).toBe(6);
  });

  it("accepts exactly 4000 code points and rejects 4001", () => {
    expect(isMessageBodyWithinLimit("😀".repeat(4000))).toBe(true);
    expect(isMessageBodyWithinLimit("😀".repeat(4001))).toBe(false);
  });
});
