import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { i18nPlugin } from "../../../i18n";
import { sitePlugin } from "../../../site";
import { defineRoutes, route, routerPlugin } from "../../index";
import type { RouteMap } from "../../types";

/** A complete, valid site config for the integration scenarios. */
const siteConfig = {
  name: "My Blog",
  url: "https://blog.dev",
  author: "Alex",
  description: "A personal blog."
};

/** A valid i18n config (en + uk). */
const i18nConfig = { locales: ["en", "uk"], defaultLocale: "en" };

/** Build an app with site + i18n + router wired in canonical order. */
function buildApp(routes: RouteMap) {
  const coreConfig = createCoreConfig("web", { config: {}, plugins: [], pluginConfigs: {} });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [sitePlugin, i18nPlugin, routerPlugin],
    pluginConfigs: { site: siteConfig, i18n: i18nConfig }
  });
  app.router.set(routes);
  return app;
}

describe("router integration", () => {
  it("createApp constructs through the real factory chain", () => {
    expect(() =>
      buildApp(defineRoutes({ home: route("/"), article: route("/{lang:?}/{slug}/") }))
    ).not.toThrow();
  });

  it("throws fail-fast on an empty route map", () => {
    expect(() => buildApp({})).toThrow(/\[web\]/);
  });

  it("match() resolves the most specific route + params", () => {
    const app = buildApp(
      defineRoutes({
        article: route("/{lang:?}/{slug}/"),
        about: route("/{lang:?}/about/")
      })
    );
    const hit = app.router.match("/en/about/");
    expect(hit?.route.pattern).toBe("/{lang:?}/about/");
    expect(hit?.params).toEqual({ lang: "en" });
  });

  it("toUrl(), entries(), manifest() work end-to-end", () => {
    const app = buildApp(defineRoutes({ home: route("/"), article: route("/{lang:?}/{slug}/") }));
    expect(app.router.toUrl("article", { lang: "uk", slug: "hi" })).toBe("/uk/hi/");
    expect(app.router.entries().map(e => e.name)).toContain("article");
    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/", "/{lang:?}/{slug}/"]);
  });

  it("manifest() preserves declaration order; entries() is specificity-sorted", () => {
    const app = buildApp(
      defineRoutes({
        article: route("/{lang:?}/{slug}/"),
        home: route("/"),
        about: route("/{lang:?}/about/")
      })
    );
    expect(app.router.manifest().map(d => d.pattern)).toEqual([
      "/{lang:?}/{slug}/",
      "/",
      "/{lang:?}/about/"
    ]);
    // entries: static "/" (0 dyn) first, then about (0 dyn after lang strip), then article (1 dyn).
    const entryPatterns = app.router.entries().map(e => e.pattern);
    expect(entryPatterns.indexOf("/{lang:?}/{slug}/")).toBe(2);
  });

  it("provides a typed app.router surface", () => {
    const app = buildApp(defineRoutes({ home: route("/") }));
    expectTypeOf(app.router.match).toBeFunction();
    expectTypeOf(app.router.toUrl).toBeFunction();
    expectTypeOf(app.router.entries).toBeFunction();
    expectTypeOf(app.router.manifest).toBeFunction();
    expectTypeOf(app.router).not.toBeUnknown();
  });

  it("50-route table: specificity ordering and correct matches", () => {
    const routes: RouteMap = {};
    // 20 static routes
    for (let i = 0; i < 20; i++) routes[`static${i}`] = route(`/page-${i}/`);
    // 15 single-dynamic routes (distinct prefixes to avoid overlap)
    for (let i = 0; i < 15; i++) routes[`single${i}`] = route(`/s${i}/{slug}/`);
    // 10 multi-dynamic routes
    for (let i = 0; i < 10; i++) routes[`multi${i}`] = route(`/m${i}/{a}/{b}/`);
    // 5 optional-lang routes
    for (let i = 0; i < 5; i++) routes[`lang${i}`] = route(`/{lang:?}/l${i}/{slug}/`);

    const app = buildApp(routes);
    const entries = app.router.entries();
    expect(entries).toHaveLength(50);

    // Specificity is non-decreasing across the sorted entries.
    const dynCounts = entries.map(e => (e.pattern.match(/\{(?!lang:\?)/g) ?? []).length);
    for (let i = 1; i < dynCounts.length; i++) {
      expect(dynCounts[i]).toBeGreaterThanOrEqual(dynCounts[i - 1] as number);
    }

    // Correct matches across the mix.
    expect(app.router.match("/page-7/")?.route.pattern).toBe("/page-7/");
    expect(app.router.match("/s3/hello/")?.params).toMatchObject({ slug: "hello" });
    expect(app.router.match("/m2/x/y/")?.params).toMatchObject({ a: "x", b: "y" });
    const langHit = app.router.match("/uk/l1/foo/");
    expect(langHit?.params).toMatchObject({ lang: "uk", slug: "foo" });
    const bareLangHit = app.router.match("/l4/bar/");
    expect(bareLangHit?.params).toMatchObject({ lang: "en", slug: "bar" });
  });
});
