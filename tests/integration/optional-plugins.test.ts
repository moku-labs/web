/**
 * @file Integration scenario — `content` and `i18n` are OPTIONAL plugins.
 *
 * A site that composes neither must still build. These scenarios are the
 * regression guard for the reported failure ("without the content plugin the
 * build won't work") and for the parallel single-locale-without-i18n case.
 *
 * - "no content" runs through the REAL shipped `createApp` (content is node-only,
 *   so the barrel simply omits it). i18n stays at its default.
 * - "no i18n" cannot use the shipped barrel (its default plugin set always bundles
 *   i18n), so it composes a core from the same exported `coreConfig`/`createCore`
 *   the barrel is built from — the real framework core, minus i18n — to prove the
 *   single default-locale fallback end-to-end.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPlugin,
  createApp,
  defineRoutes,
  headPlugin,
  route,
  routerPlugin,
  sitePlugin,
  spaPlugin
} from "../../src";
import { coreConfig, createCore } from "../../src/config";
import { cleanup, SITE, tmpDir } from "./helpers/harness";

/** A content-free, inline-rendered two-page route map (no content-plugin loaders). */
function appRoutes() {
  const home = route("/")
    .render(() => h("h1", {}, "Home"))
    .head(() => ({ title: "Home" }));
  const about = route("/about/")
    .render(() => h("p", {}, "About this site"))
    .head(() => ({ title: "About" }));
  return defineRoutes({ home, about });
}

/** Shared build flags: emit feeds + sitemap so the zero-article paths are exercised. */
const BUILD = {
  feeds: true,
  sitemap: true,
  images: false,
  ogImage: false,
  minify: false
} as const;

describe("integration: optional plugins (content + i18n are skippable)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = tmpDir("int-optional-");
  });
  afterEach(() => cleanup(tmp));

  it("builds through the real createApp with NO content plugin composed", async () => {
    // The reported bug: omitting `content` used to throw at createApp / during the
    // content phase. It must now build a routes-only site with zero articles.
    const out = path.join(tmp, "dist");
    const app = createApp({
      // contentPlugin is deliberately NOT in the list.
      plugins: [buildPlugin],
      config: { mode: "ssg" },
      pluginConfigs: {
        site: SITE,
        router: { routes: appRoutes() },
        build: { outDir: out, ...BUILD }
      }
    });

    const result = await app.build.run();

    // The pages are rendered and written — no "content is not registered" throw.
    expect(result.pageCount).toBeGreaterThan(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(existsSync(path.join(out, "about", "index.html"))).toBe(true);
    // The head plugin still composed a <title> (i18n default is present here).
    expect(readFileSync(path.join(out, "index.html"), "utf8")).toContain("<title>");
    // feeds + sitemap emitted with zero articles instead of crashing on the empty cache.
    expect(existsSync(path.join(out, "feed.xml"))).toBe(true);
    const sitemap = readFileSync(path.join(out, "sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs.toSorted()).toEqual([SITE.url, `${SITE.url}/about/`].toSorted());
  });

  it("builds through a core with NO i18n plugin composed (single default-locale fallback)", async () => {
    // The barrel always bundles i18n, so compose the framework core directly, minus
    // i18n (and content). router/head/build must fall back to the single "en" locale.
    const { createApp: createMinimalApp } = createCore(coreConfig, { plugins: [] });
    const out = path.join(tmp, "dist");
    const app = createMinimalApp({
      plugins: [sitePlugin, routerPlugin, headPlugin, spaPlugin, buildPlugin],
      config: { mode: "ssg" },
      pluginConfigs: {
        site: SITE,
        router: { routes: appRoutes() },
        build: { outDir: out, ...BUILD }
      }
    });

    // Router compiled with the fallback locale set — patterns are unprefixed.
    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/", "/about/"]);

    const result = await app.build.run();

    expect(result.pageCount).toBeGreaterThan(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    // head.render() worked without an i18n plugin (used fallbackI18n for og:locale).
    expect(readFileSync(path.join(out, "index.html"), "utf8")).toContain("<title>");
    // Single-locale output: URLs carry NO /en/ prefix (default-locale served bare).
    const sitemap = readFileSync(path.join(out, "sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs.toSorted()).toEqual([SITE.url, `${SITE.url}/about/`].toSorted());
    expect(sitemap).not.toContain("/en/");
  });
});
