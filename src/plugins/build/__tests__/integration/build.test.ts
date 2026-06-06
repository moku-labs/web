import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { contentPlugin } from "../../../content";
import { fileSystemContent } from "../../../content/providers";
import type { Article } from "../../../content/types";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { buildPlugin } from "../../index";
import type { Api, BuildResult } from "../../types";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));
const SITE = {
  name: "Build Test",
  url: "https://build.dev",
  author: "Tester",
  description: "Integration fixture site"
};

/** Load the fixture articles once so route loaders can close over them by slug. */
async function loadFixtureArticles(): Promise<Map<string, Article>> {
  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production", mode: "ssg" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [i18nPlugin, contentPlugin],
    pluginConfigs: {
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] }
    }
  });
  const byLocale = await app.content.loadAll();
  const bySlug = new Map<string, Article>();
  for (const article of byLocale.get("en") ?? []) {
    bySlug.set(article.computed.slug, article);
  }
  return bySlug;
}

/** Render pre-sanitized article HTML verbatim (delegated from the content plugin). */
function RawArticle(props: { html: string }) {
  return h("article", { dangerouslySetInnerHTML: { __html: props.html } });
}

/** Build the full SSG app (site+i18n+router+content+head+build) over a tmp outDir. */
function buildApp(outDir: string, bySlug: Map<string, Article>, extraPlugins: unknown[] = []) {
  const articleRoute = route("/{slug}/")
    .generate(() => [...bySlug.keys()].map(slug => ({ slug })))
    .load(ctx => bySlug.get(ctx.params.slug ?? ""))
    .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
    .head(ctx => ({ title: (ctx.data as Article).frontmatter.title }));
  const homeRoute = route("/")
    .render(() => h("h1", {}, "Home"))
    .head(() => ({ title: "Home" }));
  const routes = defineRoutes({ home: homeRoute, article: articleRoute });

  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production", mode: "ssg" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [
      sitePlugin,
      i18nPlugin,
      routerPlugin,
      contentPlugin,
      headPlugin,
      buildPlugin,
      ...(extraPlugins as never[])
    ],
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] },
      build: { outDir, feeds: true, sitemap: true, images: false, ogImage: false, minify: false },
      router: { routes }
    }
  });
  return app;
}

describe("build integration", () => {
  let tmp: string;
  let bySlug: Map<string, Article>;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-int-"));
    bySlug = await loadFixtureArticles();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("createApp + app.build.run() produces a dist/ tree", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    const result = await app.build.run();
    expect(result.outDir).toBe(out);
    expect(result.pageCount).toBeGreaterThan(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
  });

  it("emits build:phase (per phase, start/done) then build:complete in order", async () => {
    const out = path.join(tmp, "dist");
    const events: string[] = [];
    const coreConfig = createCoreConfig("web-test", {
      config: { stage: "production", mode: "ssg" as const },
      plugins: [logPlugin],
      pluginConfigs: { log: { mode: "test" as const } }
    });
    const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [] });
    const probe = createPlugin("build-probe", {
      depends: [buildPlugin],
      hooks: () => ({
        "build:phase": payload => {
          events.push(`phase:${payload.phase}:${payload.status}`);
        },
        "build:complete": () => {
          events.push("complete");
        }
      })
    });
    const app = buildApp(out, bySlug, [probe]);
    await app.build.run();

    // Disabled Phase-4 outputs emit NO boundary (these are off in this build).
    const disabled = new Set<string>(["og-images", "public", "not-found", "locale-redirects"]);
    // Every enabled phase emitted start then done, before the single complete.
    for (const phase of app.build.phases()) {
      if (disabled.has(phase)) {
        expect(events).not.toContain(`phase:${phase}:start`);
        expect(events).not.toContain(`phase:${phase}:done`);
        continue;
      }
      expect(events).toContain(`phase:${phase}:start`);
      expect(events).toContain(`phase:${phase}:done`);
      expect(events.indexOf(`phase:${phase}:start`)).toBeLessThan(
        events.indexOf(`phase:${phase}:done`)
      );
    }
    expect(events.at(-1)).toBe("complete");
    expect(events.filter(e => e === "complete")).toHaveLength(1);
  });

  it("sitemap URL set matches the route manifest (expanded per slug)", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run();
    const xml = readFileSync(path.join(out, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const expected = [
      "https://build.dev",
      ...[...bySlug.keys()].map(s => `https://build.dev/${s}/`)
    ];
    expect(locs.toSorted()).toEqual(expected.toSorted());
  });

  it("feed GUID set matches the content set", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run();
    const rss = readFileSync(path.join(out, "feed.xml"), "utf8");
    const guids = [...rss.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(m => m[1]);
    const expected = [...bySlug.values()].map(a => `https://build.dev${a.url}`);
    expect(guids.toSorted()).toEqual(expected.toSorted());
  });

  it("a per-route page exists for every route in the manifest", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run();
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    for (const slug of bySlug.keys()) {
      expect(existsSync(path.join(out, slug, "index.html"))).toBe(true);
    }
  });

  it("rendered pages preserve frontmatter/heading structure (delegated content intact)", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run();
    const html = readFileSync(path.join(out, "hello-world", "index.html"), "utf8");
    // Heading structure from the source Markdown survived.
    expect(html).toContain("<h1");
    expect(html).toContain("Hello World");
    // Frontmatter title flowed through head composition.
    expect(html.toLowerCase()).toContain("<title>");
  });

  it("Shiki highlight classes present in code blocks (proves content delegation)", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run();
    const html = readFileSync(path.join(out, "hello-world", "index.html"), "utf8");
    expect(html).toContain("shiki");
  });

  it("builds with all additive flags ON → emits public/404/template/locale-redirect artifacts", async () => {
    const out = path.join(tmp, "dist");
    const publicDir = path.join(tmp, "public");
    const templatePath = path.join(tmp, "shell.html");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(path.join(publicDir, "robots-custom.txt"), "custom");
    writeFileSync(
      templatePath,
      "<!doctype html><html><head><!--moku:head--><!--moku:assets--></head><body><!--moku:body--></body></html>"
    );

    const localized = route("/{lang:?}/guide/")
      .render(() => h("h1", {}, "Guide"))
      .head(() => ({ title: "Guide" }));
    const homeRoute = route("/")
      .render(() => h("h1", {}, "Home"))
      .head(() => ({ title: "Home" }));
    const routes = defineRoutes({ home: homeRoute, guide: localized });

    const coreConfig = createCoreConfig("web-test", {
      config: { stage: "production", mode: "ssg" as const },
      plugins: [logPlugin],
      pluginConfigs: { log: { mode: "test" as const } }
    });
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
    const app = createApp({
      plugins: [sitePlugin, i18nPlugin, routerPlugin, contentPlugin, headPlugin, buildPlugin],
      pluginConfigs: {
        site: SITE,
        router: { routes },
        i18n: { locales: ["en", "uk"], defaultLocale: "en" },
        content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] },
        build: {
          outDir: out,
          feeds: false,
          sitemap: false,
          images: false,
          ogImage: false,
          minify: false,
          publicDir,
          notFound: true,
          localeRedirects: true,
          injectAssets: true,
          template: templatePath
        }
      }
    });

    await app.build.run();

    // #4 publicDir copied verbatim.
    expect(existsSync(path.join(out, "robots-custom.txt"))).toBe(true);
    // #5 notFound → 404.html.
    expect(existsSync(path.join(out, "404.html"))).toBe(true);
    // #9 template fill (placeholders consumed).
    const home = readFileSync(path.join(out, "index.html"), "utf8");
    expect(home).not.toContain("<!--moku:");
    expect(home).toContain("Home");
    // #5 localeRedirects → bare-path redirect for the locale-prefixed route, no _redirects.
    const redirect = readFileSync(path.join(out, "guide", "index.html"), "utf8");
    expect(redirect).toContain("/en/guide/");
    expect(redirect).toContain('http-equiv="refresh"');
    expect(existsSync(path.join(out, "_redirects"))).toBe(false);
  });

  it("skipClean preserves prior outDir contents; a clean run wipes them", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run(); // initial full build creates the tree
    // A sentinel no phase writes — survives only when the clean is skipped.
    writeFileSync(path.join(out, "sentinel.txt"), "keep", "utf8");
    await app.build.run({ skipClean: true });
    expect(existsSync(path.join(out, "sentinel.txt"))).toBe(true);
    // A normal (clean) run removes it.
    await app.build.run();
    expect(existsSync(path.join(out, "sentinel.txt"))).toBe(false);
  });

  it("an incremental rebuild re-renders a page whose render data changed (render cache miss)", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    await app.build.run(); // full build warms the render cache

    // Change the render input for ONE article (the route renders `ctx.data.html`). If the
    // render cache wrongly reused a stale body, the assertion below would fail — so this
    // test actually discriminates a stale-cache regression (not just plumbing).
    const hello = bySlug.get("hello-world");
    if (hello) (hello as { html: string }).html = "<h1>Hello World UPDATED</h1>";

    const result = await app.build.run({
      skipClean: true,
      changed: [path.join(FIXTURE_DIR, "hello-world", "en.md")]
    });

    expect(result.pageCount).toBeGreaterThan(0);
    // The changed-data page is a render-cache MISS → its new body is emitted.
    expect(readFileSync(path.join(out, "hello-world", "index.html"), "utf8")).toContain(
      "Hello World UPDATED"
    );
    // An untouched sibling page is still present + correct after the incremental run.
    expect(existsSync(path.join(out, "second-post", "index.html"))).toBe(true);
    expect(readFileSync(path.join(out, "second-post", "index.html"), "utf8")).toContain(
      "Second Post"
    );
  });

  it("dev-profile overrides STILL emit the bare-root redirect for a locale-prefixed home (no dev 404)", async () => {
    // Regression: serve()'s dev profile must NOT disable locale-redirects — for a
    // locale-prefixed home the bare `/index.html` is the `/` → `/en/` redirect, and
    // disabling it 404s the dev root. The home lives at `/{lang}/`, so the pages phase
    // writes only `/en/` + `/uk/`; the bare `/` comes solely from locale-redirects.
    const out = path.join(tmp, "dist");
    const homeRoute = route("/{lang}/")
      .generate(ctx => [{ lang: ctx.locale }])
      .render(() => h("h1", {}, "Home"))
      .head(() => ({ title: "Home" }));
    const routes = defineRoutes({ home: homeRoute });

    const coreConfig = createCoreConfig("web-test", {
      config: { stage: "production", mode: "ssg" as const },
      plugins: [logPlugin],
      pluginConfigs: { log: { mode: "test" as const } }
    });
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
    const app = createApp({
      plugins: [sitePlugin, i18nPlugin, routerPlugin, contentPlugin, headPlugin, buildPlugin],
      pluginConfigs: {
        site: SITE,
        router: { routes },
        i18n: { locales: ["en", "uk"], defaultLocale: "en" },
        content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] },
        build: { outDir: out, localeRedirects: true, images: false, ogImage: false }
      }
    });

    // EXACTLY the overrides serve() passes for a dev build (locale-redirects NOT disabled).
    await app.build.run({ overrides: { minify: false, feeds: false, sitemap: false } });

    // The locale-prefixed pages exist…
    expect(existsSync(path.join(out, "en", "index.html"))).toBe(true);
    // …and the bare `/index.html` redirect (from locale-redirects) exists → `/` is not a 404.
    const rootIndex = path.join(out, "index.html");
    expect(existsSync(rootIndex)).toBe(true);
    const html = readFileSync(rootIndex, "utf8");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("/en/");
  });

  it("overrides disable feeds + sitemap for one run without mutating config", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug); // config has feeds + sitemap ON
    await app.build.run({ overrides: { feeds: false, sitemap: false } });
    expect(existsSync(path.join(out, "feed.xml"))).toBe(false);
    expect(existsSync(path.join(out, "sitemap.xml"))).toBe(false);
    // The persisted config is untouched: a later default run emits them again.
    await app.build.run();
    expect(existsSync(path.join(out, "feed.xml"))).toBe(true);
    expect(existsSync(path.join(out, "sitemap.xml"))).toBe(true);
  });

  it("type-level: app.build is Api; run() returns Promise<BuildResult>", async () => {
    const out = path.join(tmp, "dist");
    const app = buildApp(out, bySlug);
    expectTypeOf(app.build).toMatchTypeOf<Api>();
    expectTypeOf(app.build.run).returns.resolves.toEqualTypeOf<BuildResult>();
    expectTypeOf(app.build.phases()).toEqualTypeOf<import("../../types").PhaseName[]>();
    // @ts-expect-error — run() rejects unknown options.
    await app.build.run({ nope: true });
    rmSync(out, { recursive: true, force: true });
  });
});
