import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../../src/utils/errors/codes.js";
import { getLanguageFromHeader, t } from "../../../src/utils/i18n/index.js";

describe("getLanguageFromHeader", () => {
  it("defaults to vi when the header is missing or empty", () => {
    expect(getLanguageFromHeader(undefined)).toBe("vi");
    expect(getLanguageFromHeader(null)).toBe("vi");
    expect(getLanguageFromHeader("")).toBe("vi");
  });

  it("extracts a supported language from a full header", () => {
    expect(getLanguageFromHeader("vi-VN,vi;q=0.9,en;q=0.8")).toBe("vi");
    expect(getLanguageFromHeader("en-US,en;q=0.9")).toBe("en");
    expect(getLanguageFromHeader("EN")).toBe("en");
  });

  it("honours q-weights over header order", () => {
    expect(getLanguageFromHeader("vi;q=0.5, en;q=0.9")).toBe("en");
  });

  it("falls back to vi for unsupported languages", () => {
    expect(getLanguageFromHeader("fr-FR,fr;q=0.9")).toBe("vi");
  });
});

describe("t", () => {
  it("translates a known key per language", () => {
    expect(t("WELCOME", "vi")).toBe("Chào mừng bạn đến với ứng dụng");
    expect(t("WELCOME", "en")).toBe("Welcome to the application");
  });

  it("falls back to vi for unknown languages and to the key for unknown keys", () => {
    expect(t("WELCOME", "fr")).toBe("Chào mừng bạn đến với ứng dụng");
    expect(t("MISSING_KEY", "vi")).toBe("MISSING_KEY");
  });

  it("replaces every occurrence of each param placeholder", () => {
    expect(t("FILE_TOO_LARGE", "vi", { maxMb: "10" })).toBe(
      "File vượt quá giới hạn cho phép (10MB) — hãy chọn file nhỏ hơn 10MB",
    );
    expect(t("FILE_TOO_LARGE", "en", { maxMb: "10" })).toBe(
      "File exceeds the allowed limit (10MB) — choose a file under 10MB",
    );
  });
});

describe("error code catalogue coverage", () => {
  it("translates every ERROR_CODES value in both locales so no raw key reaches clients", () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(t(code, "vi")).not.toBe(code);
      expect(t(code, "en")).not.toBe(code);
    }
  });
});
