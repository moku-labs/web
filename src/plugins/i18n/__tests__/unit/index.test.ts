import { describe, expect, it } from "vitest";
import { createI18nApi, fallbackI18n, validateI18nConfig } from "../../api";
import type { Config } from "../../types";

/** Build a full i18n config for exercising the API closures directly. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    locales: ["en", "uk"],
    defaultLocale: "en",
    localeNames: { en: "English", uk: "Українська" },
    ogLocaleMap: { en: "en_US", uk: "uk_UA" },
    translations: {
      en: { "nav.home": "Home", "nav.about": "About" },
      uk: { "nav.home": "Головна" }
    },
    ...overrides
  };
}

/** Build the API surface over a config. */
function makeApi(overrides: Partial<Config> = {}) {
  return createI18nApi({ config: makeConfig(overrides) });
}

describe("i18n", () => {
  it("locales() returns the configured array in declared order", () => {
    expect(makeApi().locales()).toEqual(["en", "uk"]);
  });

  it("defaultLocale() returns the configured value", () => {
    expect(makeApi().defaultLocale()).toBe("en");
  });

  it("isLocale() is true for configured locales, false otherwise (case-sensitive)", () => {
    const api = makeApi();
    expect(api.isLocale("en")).toBe(true);
    expect(api.isLocale("uk")).toBe(true);
    expect(api.isLocale("fr")).toBe(false);
    expect(api.isLocale("")).toBe(false);
    expect(api.isLocale("EN")).toBe(false);
  });

  it("localeName() returns the mapped name, undefined when unmapped", () => {
    const api = makeApi();
    expect(api.localeName("uk")).toBe("Українська");
    expect(api.localeName("fr")).toBeUndefined();
  });

  it("localeName() returns undefined when localeNames defaulted to {}", () => {
    expect(makeApi({ localeNames: {} }).localeName("en")).toBeUndefined();
  });

  it("ogLocale() returns the mapped og:locale, undefined when unmapped", () => {
    const api = makeApi();
    expect(api.ogLocale("en")).toBe("en_US");
    expect(api.ogLocale("xx")).toBeUndefined();
  });

  it("ogLocale() returns undefined when ogLocaleMap defaulted to {}", () => {
    expect(makeApi({ ogLocaleMap: {} }).ogLocale("en")).toBeUndefined();
  });

  it("t() returns exact hit for the requested locale", () => {
    expect(makeApi().t("uk", "nav.home")).toBe("Головна");
  });

  it("t() falls back to default-locale value on missing key", () => {
    expect(makeApi().t("uk", "nav.about")).toBe("About");
  });

  it("t() returns the key verbatim when missing in both locales", () => {
    expect(makeApi().t("uk", "nav.missing")).toBe("nav.missing");
  });

  it("t() returns the default-locale value with a hit (no redundant default lookup)", () => {
    expect(makeApi().t("en", "nav.home")).toBe("Home");
  });

  it("t() with locale === defaultLocale and a miss returns the key", () => {
    expect(makeApi().t("en", "nav.missing")).toBe("nav.missing");
  });

  it("t() with an unknown locale falls back to the default value, else key", () => {
    const api = makeApi();
    expect(api.t("fr", "nav.about")).toBe("About");
    expect(api.t("fr", "nav.missing")).toBe("nav.missing");
  });

  it("t() returns the key when translations defaulted to {}", () => {
    expect(makeApi({ translations: {} }).t("en", "nav.home")).toBe("nav.home");
  });

  it("onInit throws when defaultLocale is not in locales", () => {
    expect(() =>
      validateI18nConfig({ config: makeConfig({ locales: ["en", "uk"], defaultLocale: "de" }) })
    ).toThrow(/\[web\].*defaultLocale/s);
  });

  it("onInit throws when locales is empty", () => {
    expect(() =>
      validateI18nConfig({ config: makeConfig({ locales: [], defaultLocale: "en" }) })
    ).toThrow(/\[web\].*locales/s);
  });

  it("onInit does not throw for a valid config", () => {
    expect(() =>
      validateI18nConfig({ config: makeConfig({ locales: ["en", "uk"], defaultLocale: "en" }) })
    ).not.toThrow();
  });
});

describe("fallbackI18n (the absent-i18n default API)", () => {
  // This is the API router/head/content/build fall back to when the i18n plugin is NOT
  // composed. It MUST behave identically to composing i18n with its default config —
  // single "en" locale, empty maps — so omitting i18n is transparent to consumers.
  it("exposes a single default 'en' locale", () => {
    expect(fallbackI18n.locales()).toEqual(["en"]);
    expect(fallbackI18n.defaultLocale()).toBe("en");
    expect(fallbackI18n.isLocale("en")).toBe(true);
    expect(fallbackI18n.isLocale("uk")).toBe(false);
  });

  it("returns undefined from every (empty) lookup map and the key from t()", () => {
    expect(fallbackI18n.localeName("en")).toBeUndefined();
    expect(fallbackI18n.ogLocale("en")).toBeUndefined();
    expect(fallbackI18n.t("en", "nav.home")).toBe("nav.home");
  });
});
