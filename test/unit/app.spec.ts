import { describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.js";

describe("AppModule imports", () => {
  it("loads the runtime module graph without circular initialization errors", () => {
    expect(AppModule).toBeDefined();
  });
});
