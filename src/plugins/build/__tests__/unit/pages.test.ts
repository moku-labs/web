/* eslint-disable unicorn/no-null -- fake `TypedRoute.match` stubs return `null` (the real signature returns `TParams | null`) */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VNode } from "preact";
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
          mode: () => "ssg",
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
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
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
          mode: () => "ssg",
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
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
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
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
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
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
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
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render }
      }
    });

    await renderPages(ctx);

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ params: {}, locale: "en" }));
    const html = readFileSync(path.join(tmp, "post", "index.html"), "utf8");
    expect(html).toContain("<title>Loaded</title>");
    expect(html).toContain("<h1>Loaded</h1>");
  });

  it("wraps the page body in the route's .layout() chrome and passes meta.activeTab + locale", async () => {
    const home = makeRoute(
      "/",
      {
        render: () => h("p", {}, "page-content"),
        layout: (lctx, children): VNode =>
          h("div", { "data-shell": "true" }, [
            h("header", {}, `tab:${String((lctx.meta as { activeTab?: string }).activeTab)}`),
            h("main", {}, h("section", {}, children)),
            h("footer", {}, `loc:${lctx.locale}`)
          ]) as VNode
      },
      { activeTab: "home" }
    );
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain("<div data-shell");
    expect(html).toContain("<header>tab:home</header>");
    // The page content is nested inside the layout's main > section swap region.
    expect(html).toContain("<main><section><p>page-content</p></section></main>");
    expect(html).toContain("<footer>loc:en</footer>");
  });

  it("a route without .layout() ships the render output verbatim (back-compat — no chrome)", async () => {
    const home = makeRoute("/", { render: () => h("p", {}, "bare") });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [home],
          entries: makeEntries([{ name: "home", pattern: "/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx);

    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain("<body><p>bare</p></body>");
    expect(html).not.toContain("<main>");
  });

  it("a hybrid data route builds and renders from its loaded data", async () => {
    // render + load (client-data-navigable) → builds the HTML + persists the data sidecar.
    const route = makeRoute("/post/", {
      load: async () => ({ title: "X" }),
      render: rctx => h("h1", {}, (rctx.data as { title: string }).title)
    });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "hybrid",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    const result = await renderPages(ctx);
    expect(result.pageCount).toBe(1);
    const html = readFileSync(path.join(tmp, "post", "index.html"), "utf8");
    expect(html).toContain("<h1>X</h1>");
  });

  it("reuse skips re-rendering a page whose data is unchanged (render cache hit)", async () => {
    const render = vi.fn((rctx: { data: unknown }) =>
      h("h1", {}, String((rctx.data as { n: number }).n))
    );
    const data = { n: 1 };
    const route = makeRoute("/post/", { load: async () => data, render });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx); // full render — body computed once + cached
    expect(render).toHaveBeenCalledTimes(1);

    await renderPages(ctx, { reuse: true }); // data unchanged → cached body reused
    expect(render).toHaveBeenCalledTimes(1);
    expect(readFileSync(path.join(tmp, "post", "index.html"), "utf8")).toContain("<h1>1</h1>");
  });

  it("reuse re-renders a page whose data changed (render cache miss)", async () => {
    let n = 1;
    const render = vi.fn((rctx: { data: unknown }) =>
      h("h1", {}, String((rctx.data as { n: number }).n))
    );
    const route = makeRoute("/post/", { load: async () => ({ n }), render });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx);
    expect(render).toHaveBeenCalledTimes(1);

    n = 2; // the page's data changes → its hash changes → it re-renders
    await renderPages(ctx, { reuse: true });
    expect(render).toHaveBeenCalledTimes(2);
    expect(readFileSync(path.join(tmp, "post", "index.html"), "utf8")).toContain("<h1>2</h1>");
  });

  it("reuse re-renders only the changed-data route and reuses the other (per-key isolation)", async () => {
    let na = 1;
    const nb = 9;
    const renderA = vi.fn((rctx: { data: unknown }) =>
      h("h1", {}, String((rctx.data as { n: number }).n))
    );
    const renderB = vi.fn((rctx: { data: unknown }) =>
      h("h2", {}, String((rctx.data as { n: number }).n))
    );
    const routeA = makeRoute("/a/", { load: async () => ({ n: na }), render: renderA });
    const routeB = makeRoute("/b/", { load: async () => ({ n: nb }), render: renderB });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [routeA, routeB],
          entries: makeEntries([
            { name: "a", pattern: "/a/" },
            { name: "b", pattern: "/b/" }
          ])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx); // full render — both bodies cached
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);

    na = 2; // only route A's data changes
    await renderPages(ctx, { reuse: true });
    expect(renderA).toHaveBeenCalledTimes(2); // A re-rendered (cache miss, per its own key)
    expect(renderB).toHaveBeenCalledTimes(1); // B reused (cache hit, isolated key)
    expect(readFileSync(path.join(tmp, "a", "index.html"), "utf8")).toContain("<h1>2</h1>");
    expect(readFileSync(path.join(tmp, "b", "index.html"), "utf8")).toContain("<h2>9</h2>");
  });

  it("never caches (always re-renders) a page whose data is not serializable", async () => {
    // BigInt is not JSON-serializable → hashData returns null → the page is never cached.
    const render = vi.fn(() => h("h1", {}, "x"));
    const route = makeRoute("/post/", { load: async () => ({ big: 1n }), render });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx);
    await renderPages(ctx, { reuse: true }); // still re-renders — non-serializable data is uncacheable
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("a full (non-reuse) render always re-renders even when the cache is warm", async () => {
    const render = vi.fn(() => h("h1", {}, "x"));
    const route = makeRoute("/post/", { load: async () => ({ n: 1 }), render });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await renderPages(ctx); // warms the cache
    await renderPages(ctx); // full again → re-renders (cache cleared + rebuilt)
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("ssg mode builds a data route", async () => {
    const route = makeRoute("/post/", {
      load: async () => ({ title: "X" }),
      render: rctx => h("h1", {}, (rctx.data as { title: string }).title)
    });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: {
          mode: () => "ssg",
          manifest: () => [route],
          entries: makeEntries([{ name: "post", pattern: "/post/" }])
        },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" },
        head: { render: () => "" }
      }
    });

    await expect(renderPages(ctx)).resolves.toBeDefined();
  });
});
