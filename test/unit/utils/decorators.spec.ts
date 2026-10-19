import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { langParamFactory } from "../../../src/utils/decorators.js";

function createContext(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe("Lang", () => {
  it("resolves the language from the accept-language header", () => {
    const context = createContext({ "accept-language": "en-US,en;q=0.9" });
    expect(langParamFactory(undefined, context)).toBe("en");
  });

  it("falls back to vi when the request has no accept-language header", () => {
    expect(langParamFactory(undefined, createContext({}))).toBe("vi");
  });
});
