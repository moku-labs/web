/* eslint-disable unicorn/no-null -- fake `TypedRoute.match` stubs return `null` (the real signature returns `TParams | null`) */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RouteDefinition, TypedRoute } from "../../../router/types";
import { generateSitemap } from "../../phases/sitemap";
import { makeCtx } from "../helpers";

/** Minimal RouteDefinition carrier. */
function makeRoute(pattern: string, handlers: RouteDefinition["_handlers"] = {}): RouteDefinition {
  return { pattern, _meta: {}, _handlers: handlers };
}

/** `{param}` / `{param:?}` substitution mirroring `router`'s compiled `toUrl`. */
function substitute(pattern: string, params: Record<string, string>): string {
  return pattern
    .split("/")
    .map(segment => {
      if (!segment.startsWith("{") || !segment.endsWith("}")) return segment;
      const inner = segment.slice(1, -1);
      const key = inner.endsWith(":?") ? inner.slice(0, -2) : inner;
      return params[key] ?? "";
    })
    .join("/")
    .replaceAll(/\/{2,}/g, "/");
}

/** Build a fake `router.entries()` set (TypedRoute closures) from named routes. */
function makeEntries(routes: { name: string; pattern: string }[]): () => TypedRoute[] {
  return () =>
    routes.map(({ name, pattern }) => ({
      pattern,
      name,
      meta: {},
      toUrl: (params: Record<string, string>) => substitute(pattern, params),
      toFile: (params: Record<string, string>) => `${substitute(pattern, params)}index.html`,
      match: () => null
    }));
}

describe("build/phases/sitemap", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-sitemap-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("derives the correct URL set from the manifest + site.url", async () => {
    const home = makeRoute("/");
    const article = makeRoute("/{slug}/", {
      generate: () => [{ slug: "hello" }, { slug: "world" }]
    });
    const ctx = makeCtx({
      config: { outDir: tmp, sitemap: true },
      requireMap: {
        site: { url: () => "https://blog.dev", canonical: (p: string) => `https://blog.dev${p}` },
        i18n: { locales: () => ["en"] },
        router: {
          manifest: () => [home, article],
          entries: makeEntries([
            { name: "home", pattern: "/" },
            { name: "article", pattern: "/{slug}/" }
          ])
        }
      }
    });

    const result = await generateSitemap(ctx);

    expect(result?.urls).toEqual([
      "https://blog.dev/",
      "https://blog.dev/hello/",
      "https://blog.dev/world/"
    ]);
    const xml = readFileSync(path.join(tmp, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://blog.dev/hello/</loc>");
    const robots = readFileSync(path.join(tmp, "robots.txt"), "utf8");
    expect(robots).toContain("Sitemap: https://blog.dev/sitemap.xml");
  });

  it("emits each URL once when a route collapses across locales (no duplicates)", async () => {
    // Regression: a route with no {lang}/{lang:?} placeholder (or whose generate()
    // omits `lang`) resolves to the SAME URL for every locale — the fan-out pushed one
    // duplicate sitemap entry per locale. Localized routes must still keep every locale.
    const home = makeRoute("/");
    const feed = makeRoute("/feed/");
    const guide = makeRoute("/{lang}/guide/", {
      generate: (gctx: { locale: string }) => [{ lang: gctx.locale }]
    });
    const ctx = makeCtx({
      config: { outDir: tmp, sitemap: true },
      requireMap: {
        site: { url: () => "https://blog.dev", canonical: (p: string) => `https://blog.dev${p}` },
        i18n: { locales: () => ["en", "uk"] },
        router: {
          manifest: () => [home, feed, guide],
          entries: makeEntries([
            { name: "home", pattern: "/" },
            { name: "feed", pattern: "/feed/" },
            { name: "guide", pattern: "/{lang}/guide/" }
          ])
        }
      }
    });

    const result = await generateSitemap(ctx);

    expect(result?.urls).toEqual([
      "https://blog.dev/",
      "https://blog.dev/feed/",
      "https://blog.dev/en/guide/",
      "https://blog.dev/uk/guide/"
    ]);
    const xml = readFileSync(path.join(tmp, "sitemap.xml"), "utf8");
    expect(xml.match(/<loc>https:\/\/blog\.dev\/feed\/<\/loc>/g)).toHaveLength(1);
  });

  it("is a no-op when config.sitemap is false", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, sitemap: false } });
    expect(await generateSitemap(ctx)).toBeNull();
  });
});
