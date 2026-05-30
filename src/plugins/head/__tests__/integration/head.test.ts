import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { i18nPlugin } from "../../../i18n";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { headPlugin } from "../../index";
import type { ResolvedRoute } from "../../types";

/** A complete, valid site config. */
const siteConfig = {
  name: "My Blog",
  url: "https://blog.dev",
  author: "Alex",
  description: "A personal blog."
};

/** A valid i18n config (en + uk) with og + name maps. */
const i18nConfig = {
  locales: ["en", "uk"],
  defaultLocale: "en",
  localeNames: { en: "English", uk: "Українська" },
  ogLocaleMap: { en: "en_US", uk: "uk_UA" }
};

/** Build an app with site + i18n + router + head wired in canonical order. */
function buildApp(headConfig: Record<string, unknown> = {}) {
  const coreConfig = createCoreConfig("web", { config: {}, plugins: [], pluginConfigs: {} });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin],
    pluginConfigs: {
      site: siteConfig,
      i18n: i18nConfig,
      router: { routes: defineRoutes({ article: route("/{lang:?}/{slug}/") }) },
      head: headConfig
    }
  });
}

describe("head integration", () => {
  it("createApp boots with head + site + i18n + router", () => {
    expect(() => buildApp()).not.toThrow();
  });

  it("throws fail-fast [head] config: ... on an invalid titleTemplate", () => {
    expect(() => buildApp({ titleTemplate: "no token" })).toThrow(/\[head\] config:/);
  });

  it("app.head.render(route, data) produces composed <head> inner HTML", () => {
    const app = buildApp({ titleTemplate: "%s — My Blog", twitterHandle: "@moku_labs" });
    const route: ResolvedRoute = {
      path: "/en/hello/",
      params: { lang: "en", slug: "hello" },
      locale: "en",
      name: "article",
      head: { title: "Hello", description: "A greeting" }
    };
    const html = app.head.render(route, {});
    expect(html).toContain("<title>Hello — My Blog</title>");
    expect(html).toContain('name="description" content="A greeting"');
    expect(html).toContain('property="og:title" content="Hello"');
    expect(html).toContain('name="twitter:site" content="@moku_labs"');
    expect(html).toContain('rel="canonical"');
    // hreflang alternates for every locale + x-default.
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="uk"');
    expect(html).toContain('hreflang="x-default"');
  });

  it("escapes HTML in composed attribute + text values", () => {
    const app = buildApp();
    const route: ResolvedRoute = {
      path: "/en/x/",
      params: { lang: "en", slug: "x" },
      locale: "en",
      name: "article",
      head: { title: "A & B <tag>", description: 'quote "x"' }
    };
    const html = app.head.render(route, {});
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<tag>");
  });

  it("provides a typed app.head.render surface", () => {
    const app = buildApp();
    expectTypeOf(app.head.render).toBeFunction();
    expectTypeOf(app.head).not.toBeUnknown();
  });
});
