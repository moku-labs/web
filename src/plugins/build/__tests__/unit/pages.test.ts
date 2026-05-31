/* eslint-disable unicorn/no-null -- fake `TypedRoute.match` stubs return `null` (the real signature returns `TParams | null`) */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDefinition, TypedRoute } from "../../../router/types";
import { renderPages } from "../../phases/pages";
import { makeCtx } from "../helpers";

/** Build a minimal RouteDefinition carrier for the pages phase. */
function makeRoute(
  pattern: string,
  handlers: RouteDefinition["_handlers"],
  meta: Record<string, unknown> = {}
): RouteDefinition {
  return { pattern, _meta: meta, _handlers: handlers };
}

/**
 * Standard `{param}` / `{param:?}` substitution used by the fake router entries
 * (mirrors `router`'s compiled `toUrl`); the pages phase pulls write paths from
 * these `TypedRoute` closures rather than re-deriving from the pattern.
 */
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
      toFile: (params: Record<string, string>) => {
        const clean = substitute(pattern, params).replace(/^\//, "").replace(/\/$/, "");
        return clean === "" ? "index.html" : `${clean}/index.html`;
      },
      match: () => null
    }));
}

describe("build/phases/pages", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-pages-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("pulls router.manifest() + head.render() for each route", async () => {
    const home = makeRoute("/", {
      render: () => h("h1", {}, "Home")
    });
    const about = makeRoute("/about/", {
      render: () => h("p", {}, "About"),
      head: () => ({ title: "About" })
    });
    const manifest = vi.fn(() => [home, about]);
    const render = vi.fn(() => "<title>HEAD</title>");
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          manifest,
          entries: makeEntries([
            { name: "home", pattern: "/" },
            { name: "about", pattern: "/about/" }
          ])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render }
      }
    });

    const result = await renderPages(ctx);

    expect(manifest).toHaveBeenCalledTimes(1);
    // head.render pulled once per route instance.
    expect(render).toHaveBeenCalledTimes(2);
    expect(result.pageCount).toBe(2);
    // Manifest cached on state for downstream phases.
    expect(ctx.state.manifest).toHaveLength(2);
  });

  it("injects the build-id meta tag into rendered pages (after head.render)", async () => {
    const home = makeRoute("/", { render: () => h("h1", {}, "Home") });
    const ctx = makeCtx({
      config: { outDir: tmp },
      runId: "RUNID-123",
      requireMap: {
        router: { manifest: () => [home], entries: makeEntries([{ name: "home", pattern: "/" }]) },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "<title>Home</title>" }
      }
    });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain('<meta name="build-id" content="RUNID-123">');
    // The build-id appears AFTER the composed head HTML, inside <head>.
    expect(html.indexOf("<title>Home</title>")).toBeLessThan(html.indexOf("build-id"));
    expect(html).toContain("<h1>Home</h1>");
  });

  it("writes correct output paths (root + nested + generated params)", async () => {
    const home = makeRoute("/", { render: () => h("div", {}, "root") });
    const article = makeRoute("/{slug}/", {
      generate: () => [{ slug: "hello" }, { slug: "world" }],
      render: rctx => h("div", {}, (rctx.params as Record<string, string>).slug)
    });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          manifest: () => [home, article],
          entries: makeEntries([
            { name: "home", pattern: "/" },
            { name: "article", pattern: "/{slug}/" }
          ])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    const result = await renderPages(ctx);

    expect(result.pageCount).toBe(3);
    expect(existsSync(path.join(tmp, "index.html"))).toBe(true);
    expect(existsSync(path.join(tmp, "hello", "index.html"))).toBe(true);
    expect(existsSync(path.join(tmp, "world", "index.html"))).toBe(true);
    // Root page HTML captured for the root-index phase.
    expect(result.rootHtml).toContain("root");
  });

  it("injects bundled CSS/JS asset tags from the typed manifest when injectAssets is on (default)", async () => {
    const home = makeRoute("/", { render: () => h("h1", {}, "Home") });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: { manifest: () => [home], entries: makeEntries([{ name: "home", pattern: "/" }]) },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });
    // Seed a typed BuildCacheEntry manifest (as the bundle phase would).
    ctx.state.buildCache.set("css", { "main.css": "assets/main-abc123.css" });
    ctx.state.buildCache.set("js", { "main.js": "assets/main-def456.js" });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain('<link rel="stylesheet" href="/assets/main-abc123.css">');
    expect(html).toContain('<script type="module" src="/assets/main-def456.js"></script>');
  });

  it("omits asset tags when injectAssets is false", async () => {
    const home = makeRoute("/", { render: () => h("h1", {}, "Home") });
    const ctx = makeCtx({
      config: { outDir: tmp, injectAssets: false },
      requireMap: {
        router: { manifest: () => [home], entries: makeEntries([{ name: "home", pattern: "/" }]) },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });
    ctx.state.buildCache.set("css", { "main.css": "assets/main-abc123.css" });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).not.toContain("stylesheet");
  });

  it("fills <!--moku:head/body/assets--> placeholders when a template is configured", async () => {
    const templatePath = path.join(tmp, "shell.html");
    writeFileSync(
      templatePath,
      "<!doctype html><html><head><!--moku:head--><!--moku:assets--></head><body><!--moku:body--></body></html>"
    );
    const home = makeRoute("/", { render: () => h("h1", {}, "Home") });
    const ctx = makeCtx({
      config: { outDir: tmp, template: templatePath },
      requireMap: {
        router: { manifest: () => [home], entries: makeEntries([{ name: "home", pattern: "/" }]) },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "<title>Home</title>" }
      }
    });
    ctx.state.buildCache.set("css", { "main.css": "assets/main-abc.css" });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain("<title>Home</title>");
    expect(html).toContain("<h1>Home</h1>");
    expect(html).toContain("/assets/main-abc.css");
    expect(html).not.toContain("<!--moku:");
  });

  it("passes loaded data into head.render and the renderer", async () => {
    const load = vi.fn(async () => ({ title: "Loaded" }));
    const route = makeRoute("/post/", {
      load,
      render: rctx => h("h1", {}, (rctx.data as { title: string }).title),
      head: rctx => ({ title: (rctx.data as { title: string }).title })
    });
    const render = vi.fn(
      (_r: unknown, data: unknown) => `<title>${(data as { title: string }).title}</title>`
    );
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render }
      }
    });

    await renderPages(ctx);

    expect(load).toHaveBeenCalledWith({}, "en");
    const html = readFileSync(path.join(tmp, "post", "index.html"), "utf8");
    expect(html).toContain("<title>Loaded</title>");
    expect(html).toContain("<h1>Loaded</h1>");
  });
});
