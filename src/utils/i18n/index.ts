import en from "./locales/en.json" with { type: "json" };
import vi from "./locales/vi.json" with { type: "json" };

export type TranslationKey = keyof typeof en;

const locales: Record<string, Record<string, string>> = {
  en,
  vi,
};

export const getLanguageFromHeader = (acceptLanguage: string | null | undefined): string => {
  if (!acceptLanguage) {
    return "vi";
  } // Default to Vietnamese

  const langs = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, q] = lang.split(";");
      return {
        code: code.trim().substring(0, 2).toLowerCase(),
        q: q ? parseFloat(q.split("=")[1]) : 1.0,
      };
    })
    .sort((a, b) => b.q - a.q);

  for (const lang of langs) {
    if (locales[lang.code]) {
      return lang.code;
    }
  }

  return "vi";
};

export const hasTranslation = (key: string): key is TranslationKey => Object.hasOwn(en, key);

export const t = (key: TranslationKey, lang: string, params?: Record<string, string>): string => {
  const dictionary = locales[lang] || locales["vi"];
  let text = dictionary[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }

  return text;
};
