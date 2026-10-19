import { describe, expect, expectTypeOf, it } from "vitest";
import {
  created,
  messageOnly,
  ok,
  withMessage,
  type SuccessResponse,
} from "../../../src/utils/response.js";

describe("SuccessResponse", () => {
  it("types message-only responses with an optional undefined data key", () => {
    expectTypeOf<SuccessResponse>().branded.toEqualTypeOf<{
      success: true;
      message: string;
      data?: undefined;
    }>();
  });
});

describe("ok", () => {
  it("wraps data with the OK literal message", () => {
    expect(ok({ a: 1 })).toEqual({ success: true, message: "OK", data: { a: 1 } });
  });

  it("preserves the data type", () => {
    expectTypeOf(ok({ a: 1 })).toEqualTypeOf<SuccessResponse<{ a: number }>>();
  });
});

describe("withMessage", () => {
  it("wraps data with a custom message", () => {
    expect(withMessage({ a: 1 }, "Custom")).toEqual({
      success: true,
      message: "Custom",
      data: { a: 1 },
    });
  });
});

describe("messageOnly", () => {
  it("serializes without a data key", () => {
    const response = messageOnly("Done");
    expect(response).toEqual({ success: true, message: "Done" });
    expect(Object.hasOwn(response, "data")).toBe(false);
    // @ts-expect-error message-only responses never carry data
    response.data = { data: 1 };
  });
});

describe("created", () => {
  it("wraps data with a custom message", () => {
    expect(created({ id: 1 }, "Story created")).toEqual({
      success: true,
      message: "Story created",
      data: { id: 1 },
    });
  });
});
