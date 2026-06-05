/**
 * @file Integration: routes registered the normal config way via
 * `pluginConfigs.router.routes` — the SOLE registration path. Proves the router compiles
 * the table at init (manifest/match/toUrl), reads the render mode from the GLOBAL config,
 * accepts an `import * as` namespace, throws fail-fast on an empty map, and that reading
 * before any routes are registered throws a clear error.
 */
import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import { i18nPlugin } from "../../../i18n";
import { sitePlugin } from "../../../site";
import { defineRoutes, route, routerPlugin } from "../../index";
import type { RouteMap } from "../../types";
import * as routesNamespace from "./fixtures/routes-namespace";

const SITE = { name: "Config Routes Test", url: "https://cfg.dev", author: "T", description: "d" };
const I18N = { locales: ["en"], defaultLocale: "en" };

/** Build a site+i18n+router app that registers `routes` via `pluginConfigs.router.routes`. */
function makeApp(routes: RouteMap, mode: "ssg" | "spa" | "hybrid" = "hybrid") {
  const coreConfig = createCoreConfig("web", {
    config: { isDevelopment: false, mode },
    plugins: [],
    pluginConfigs: {}
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [sitePlugin, i18nPlugin, routerPlugin],
    pluginConfigs: { site: SITE, i18n: I18N, router: { routes } }
  });
}

/** Build the same app with NO router config routes (table stays empty; every read throws). */
function makeAppNoRoutes() {
  const coreConfig = createCoreConfig("web", {
    config: { isDevelopment: false, mode: "hybrid" },
    plugins: [],
    pluginConfigs: {}
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [sitePlugin, i18nPlugin, routerPlugin],
    pluginConfigs: { site: SITE, i18n: I18N }
  });
}

describe("pluginConfigs.router.routes", () => {
  it("compiles the table at init — manifest, match, and toUrl work with no set() call", () => {
    const app = makeApp(defineRoutes({ home: route("/"), article: route("/{slug}/") }));

    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/", "/{slug}/"]);
    expect(app.router.match("/hello/")?.params).toEqual({ slug: "hello" });
    expect(app.router.toUrl("article", { slug: "hello" })).toBe("/hello/");
  });

  it("accepts an `import * as routes` namespace as the config value", () => {
    const app = makeApp(routesNamespace);
    expect(
      app.router
        .manifest()
        .map(d => d.pattern)
        .toSorted()
    ).toEqual(["/", "/{slug}/"]);
    expect(app.router.match("/hello/")?.params).toEqual({ slug: "hello" });
  });

  it("reads the render mode from the GLOBAL config (not router config)", () => {
    expect(makeApp(defineRoutes({ home: route("/") }), "ssg").router.mode()).toBe("ssg");
    expect(makeApp(defineRoutes({ home: route("/") }), "spa").router.mode()).toBe("spa");
  });

  it("throws fail-fast at init on an empty route map in config", () => {
    expect(() => makeApp(defineRoutes({}))).toThrow(/route map is empty/);
  });

  it("without config routes, every read throws a clear 'routes not registered' error", () => {
    const app = makeAppNoRoutes();
    expect(() => app.router.match("/")).toThrow(/routes not registered/);
    expect(() => app.router.toUrl("home", {})).toThrow(/routes not registered/);
  });
});
