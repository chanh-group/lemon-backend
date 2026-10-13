import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "@nestjs/common";
import { AppLogger, createAppLogger, createAppLoggerOptions } from "../../../src/utils/logger.js";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_TIMESTAMP_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

function captureStdout(run: () => void): string {
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    run();
    return writeSpy.mock.calls.map((call) => String(call[0])).join("");
  } finally {
    writeSpy.mockRestore();
  }
}

describe("createAppLoggerOptions", () => {
  it("returns human-readable options with colors in development", () => {
    const devOptions = createAppLoggerOptions("development");
    expect(devOptions.json).toBe(false);
    expect(devOptions.colors).toBe(true);
    expect(devOptions.logLevels).toContain("debug");
    expect(devOptions.logLevels).toContain("verbose");
    expect(devOptions.logLevels).toContain("fatal");
  });

  it("returns JSON options without debug/verbose in production", () => {
    const prodOptions = createAppLoggerOptions("production");
    expect(prodOptions.json).toBe(true);
    expect(prodOptions.colors).toBe(false);
    expect(prodOptions.logLevels).toContain("log");
    expect(prodOptions.logLevels).toContain("error");
    expect(prodOptions.logLevels).toContain("warn");
    expect(prodOptions.logLevels).toContain("fatal");
    expect(prodOptions.logLevels).not.toContain("debug");
    expect(prodOptions.logLevels).not.toContain("verbose");
  });
});

describe("AppLogger output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one JSON line with ISO timestamp and params in production", () => {
    const output = captureStdout(() => {
      const logger = createAppLogger("production");
      logger.log("hello", { action: "greet" });
    });

    expect(output.endsWith("\n")).toBe(true);
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed["message"]).toBe("hello");
    expect(parsed["level"]).toBe("log");
    expect(parsed["timestamp"]).toMatch(ISO_TIMESTAMP);
    expect(parsed["params"]).toEqual({ action: "greet" });
  });

  it("emits ISO timestamp in human-readable output in development", () => {
    const output = captureStdout(() => {
      const logger = createAppLogger("development");
      logger.log("hello");
    });

    expect(output).toMatch(ISO_TIMESTAMP_IN_TEXT);
    expect(output).toContain("hello");
  });

  it("AppLogger extends ConsoleLogger and returns ISO timestamp from getTimestamp()", () => {
    const logger = new AppLogger();
    expect(logger).toBeInstanceOf(ConsoleLogger);
    expect(logger.getTimestamp()).toMatch(ISO_TIMESTAMP);
  });
});
