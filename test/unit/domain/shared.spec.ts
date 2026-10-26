import { describe, expect, it } from "vitest";
import { parseCursorPage, toCursorPage } from "../../../src/domain/shared.js";

describe("cursor pagination helpers", () => {
  it("returns a next cursor only when the extra row proves another page exists", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(toCursorPage(rows, 2, (row) => row.id)).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      nextCursor: "b",
      hasMore: true,
    });
    expect(toCursorPage(rows.slice(0, 2), 2, (row) => row.id)).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      hasMore: false,
    });
  });

  it("bounds page size and rejects invalid cursor or size values", () => {
    const cursor = "0193a2b1-0000-7000-8000-000000000001";
    expect(parseCursorPage(cursor, "500")).toEqual({ cursor, size: 50 });
    expect(parseCursorPage(undefined, undefined)).toEqual({ cursor: undefined, size: 20 });
    expect(() => parseCursorPage("bad", "20")).toThrow();
    expect(() => parseCursorPage(undefined, "0")).toThrow();
    expect(() => parseCursorPage(undefined, "1.5")).toThrow();
  });

  it("supports opaque base64url cursors only when allowOpaque option is enabled", () => {
    const opaqueCursor = "MTc5Mjg0MzE5NTMxN18wMTkzYTJiMS0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDE";
    expect(() => parseCursorPage(opaqueCursor, "20")).toThrow();
    expect(parseCursorPage(opaqueCursor, "20", 20, 50, { allowOpaque: true })).toEqual({
      cursor: opaqueCursor,
      size: 20,
    });
  });
});
