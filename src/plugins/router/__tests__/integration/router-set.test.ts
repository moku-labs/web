/**
 * @file Integration: `app.router.set(routes)` — the pre-start route registration
 * that replaces config routes. Proves it compiles the table (manifest/match/toUrl),
 * reads the render mode from the GLOBAL config, throws before registration and on an
 * empty/invalid map, recompiles on re-`set()`, and accepts an `import * as` namespace.
 */
import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import { i18nPlugin } from "../../../i18n";
import { sitePlugin } from "../../../site";
import { defineRoutes, route, routerPlugin } from "../../index";
import * as routesNamespace from "./fixtures/routes-namespace";

const SITE = { name: "Set Test", url: "https://set.dev", author: "T", description: "d" };

/** Build a minimal site+i18n+router app at a given global render mode. */
function makeApp(mode: "ssg" | "spa" | "hybrid" = "hybrid") {
  const coreConfig = createCoreConfig("web", {
    config: { isDevelopment: false, mode },
    plugins: [],
    pluginConfigs: {}
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [sitePlugin, i18nPlugin, routerPlugin],
    pluginConfigs: { site: SITE, i18n: { locales: ["en"], defaultLocale: "en" } }
  });
}

describe("app.router.set(routes)", () => {
  it("compiles the table: manifest, match, and toUrl all work after set()", () => {
    const app = makeApp();
    app.router.set(defineRoutes({ home: route("/"), article: route("/{slug}/") }));

    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/", "/{slug}/"]);
    expect(app.router.match("/hello/")?.params).toEqual({ slug: "hello" });
    expect(app.router.toUrl("article", { slug: "hello" })).toBe("/hello/");
  });

  it("reads the render mode from the GLOBAL config (not router config)", () => {
    expect(makeApp("ssg").router.mode()).toBe("ssg");
    expect(makeApp("spa").router.mode()).toBe("spa");
    expect(makeApp("hybrid").router.mode()).toBe("hybrid");
  });

  it("throws a clear error if the table is read before set()", () => {
    const app = makeApp();
    expect(() => app.router.match("/")).toThrow(/routes not registered/);
  });

  it("throws fail-fast on an empty route map", () => {
    const app = makeApp();
    expect(() => app.router.set(defineRoutes({}))).toThrow(/\[web\]/);
  });

  it("re-calling set() recompiles the table (last write wins)", () => {
    const app = makeApp();
    app.router.set(defineRoutes({ home: route("/") }));
    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/"]);

    app.router.set(defineRoutes({ about: route("/about/"), post: route("/{slug}/") }));
    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/about/", "/{slug}/"]);
  });

  it("accepts an `import * as routes` module namespace", () => {
    const app = makeApp();
    app.router.set(routesNamespace);
    expect(
      app.router
        .manifest()
        .map(d => d.pattern)
        .toSorted()
    ).toEqual(["/", "/{slug}/"]);
  });
});
