import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { i18nPlugin } from "../../index";

/** Fresh framework config registering no core plugins. */
function makeConfig() {
  return createCoreConfig("web", { config: {}, plugins: [], pluginConfigs: {} });
}

/** Build an app with i18nPlugin as a regular plugin and the given i18n config. */
function buildApp(i18n?: Record<string, unknown>) {
  const coreConfig = makeConfig();
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [i18nPlugin],
    ...(i18n ? { pluginConfigs: { i18n } } : {})
  });
}

describe("i18n integration", () => {
  it("createApp constructs synchronously with a full i18n config", () => {
    expect(() =>
      buildApp({
        locales: ["en", "uk"],
        defaultLocale: "en",
        localeNames: { en: "English", uk: "Українська" },
        ogLocaleMap: { en: "en_US" },
        translations: { en: { "nav.home": "Home" }, uk: { "nav.home": "Головна" } }
      })
    ).not.toThrow();
  });

  it("app.i18n.* returns expected values through the wired surface", () => {
    const app = buildApp({
      locales: ["en", "uk"],
      defaultLocale: "en",
      localeNames: { en: "English", uk: "Українська" },
      ogLocaleMap: { en: "en_US" },
      translations: { en: { "nav.home": "Home" }, uk: { "nav.home": "Головна" } }
    });
    expect(app.i18n.locales()).toEqual(["en", "uk"]);
    expect(app.i18n.defaultLocale()).toBe("en");
    expect(app.i18n.isLocale("uk")).toBe(true);
    expect(app.i18n.isLocale("fr")).toBe(false);
    expect(app.i18n.localeName("uk")).toBe("Українська");
    expect(app.i18n.localeName("fr")).toBeUndefined();
    expect(app.i18n.ogLocale("en")).toBe("en_US");
    expect(app.i18n.ogLocale("uk")).toBeUndefined();
    expect(app.i18n.t("uk", "nav.home")).toBe("Головна");
    // en-fallback path: missing key in uk falls back to the en value.
    expect(app.i18n.t("uk", "nav.missing")).toBe("nav.missing");
    expect(app.i18n.t("uk", "nav.home")).toBe("Головна");
  });

  it("t() en-fallback path resolves a default-locale value", () => {
    const app = buildApp({
      locales: ["en", "uk"],
      defaultLocale: "en",
      translations: { en: { "nav.about": "About" } }
    });
    expect(app.i18n.t("uk", "nav.about")).toBe("About");
  });

  it('createApp({}) constructs with defaults and defaultLocale() === "en"', () => {
    const app = buildApp();
    expect(app.i18n.defaultLocale()).toBe("en");
    expect(app.i18n.locales()).toEqual(["en"]);
  });

  it("createApp throws fast for an invalid i18n config (at construction)", () => {
    expect(() => buildApp({ locales: ["en"], defaultLocale: "uk" })).toThrow(
      /\[web\].*defaultLocale/s
    );
  });

  it("type-level: app.i18n surface types are correct", () => {
    const app = buildApp();
    expectTypeOf(app.i18n.locales).returns.toEqualTypeOf<readonly string[]>();
    expectTypeOf(app.i18n.isLocale).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(app.i18n.isLocale).returns.toEqualTypeOf<boolean>();
    expectTypeOf(app.i18n.localeName).returns.toEqualTypeOf<string | undefined>();
    expectTypeOf(app.i18n.t).returns.toEqualTypeOf<string>();
    // @ts-expect-error — `key` argument is required.
    app.i18n.t("en");
    // app.i18n is present and typed (not unknown).
    expectTypeOf(app.i18n).not.toBeUnknown();
  });
});
