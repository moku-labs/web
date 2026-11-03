import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logPlugin } from "@moku-labs/common";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlugin } from "../../../build";
import { contentPlugin } from "../../../content";
import { fileSystemContent } from "../../../content/providers";
import type { Article, ArticleCard } from "../../../content/types";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { dataPlugin } from "../../index";

/** Fixture: one published article (`hello-world`) + one draft (`secret-draft`). */
const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));
const SITE = {
  name: "Data Test",
  url: "https://data.dev",
  author: "Tester",
  description: "Agnostic data provider fixture site"
};

/** Render pre-sanitized article HTML verbatim. */
function RawArticle(props: { html: string }) {
  return h("article", { dangerouslySetInnerHTML: { __html: props.html } });
}

/** Preload the production-filtered article set (drafts excluded) for the route loaders. */
async function loadArticles(): Promise<{ bySlug: Map<string, Article>; cards: ArticleCard[] }> {
  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production" },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [i18nPlugin, contentPlugin],
    pluginConfigs: {
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: {
        providers: [fileSystemContent({ contentDir: FIXTURE_DIR, shikiLanguages: ["ts"] })]
      }
    }
  });
  const bySlug = new Map<string, Article>();
  const cards: ArticleCard[] = [];
  const byLocale = await app.content.loadAll();
  for (const article of byLocale.get("en") ?? []) {
    bySlug.set(article.computed.slug, article);
    cards.push(app.content.articleToCard(article));
  }
  return { bySlug, cards };
}

/** Compose the full SSG app with the data provider over a tmp outDir (hybrid mode). */
function makeApp(
  outDir: string,
  bySlug: Map<string, Article>,
  cards: ArticleCard[],
  data: { preload?: "none" | "all" } = {}
) {
  const home = route("/")
    .load(() => cards) // list view → slim CARDS
    .render(() => h("h1", {}, `Home (${String(cards.length)})`))
    .head(() => ({ title: "Home" }));
  const article = route("/{slug}/")
    .generate(() => [...bySlug.keys()].map(slug => ({ slug })))
    .load(ctx => bySlug.get(ctx.params.slug ?? "")) // detail view → ONE full article
    .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
    .head(ctx => ({ title: (ctx.data as Article).frontmatter.title }));
  // #1 — static route: render + head, NO .load(); still gets an empty {} sidecar.
  const about = route("/about/")
    .render(() => h("h1", {}, "About"))
    .head(() => ({ title: "About" }));
  // #3b — loader resolves the content API the spec way: ctx.require(contentPlugin).
  const viaContent = route("/{slug}/via/")
    .generate(() => [...bySlug.keys()].map(slug => ({ slug })))
    .load(async ctx => {
      const found = await ctx.require(contentPlugin).load(ctx.params.slug ?? "", ctx.locale);
      return { html: found.html };
    })
    .render(
      ctx => h(RawArticle, { html: (ctx.data as { html: string }).html }) as ReturnType<typeof h>
    )
    .head(() => ({ title: "Via" }));
  const routes = defineRoutes({ home, article, about, viaContent });

  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production", mode: "hybrid" as const },
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
      dataPlugin
    ],
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: {
        providers: [fileSystemContent({ contentDir: FIXTURE_DIR, shikiLanguages: ["ts"] })]
      },
      build: { outDir, feeds: false, sitemap: false, images: false, ogImage: false, minify: false },
      router: { routes },
      data
    }
  });
  return app;
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "moku-data-int-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("data provider — build writes per-page data → at() reads it", () => {
  it("build.run() writes a slim card list for home and one full article per slug", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run(); // writes HTML + per-page data sidecars (hybrid mode)

    // Home → cards (no html bodies).
    const home = JSON.parse(readFileSync(path.join(outDir, "_data", "index.json"), "utf8"));
    expect(Array.isArray(home)).toBe(true);
    expect(JSON.stringify(home)).not.toContain("<"); // cards carry no HTML body

    // Article → one full article at its own per-slug file.
    const article = JSON.parse(
      readFileSync(path.join(outDir, "_data", "hello-world", "index.json"), "utf8")
    ) as Article;
    expect(article.computed.slug).toBe("hello-world");
    expect(article.html).toContain("Hello World");
  });

  it("draft-safety gate: a production build writes ZERO draft data", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run();

    // The draft slug must not have a data file, nor appear in any written data.
    expect(() => readFileSync(path.join(outDir, "_data", "secret-draft", "index.json"))).toThrow();
    const home = readFileSync(path.join(outDir, "_data", "index.json"), "utf8");
    expect(home).not.toContain("secret-draft");
  });

  it("at(path) round-trips the written file (fetch serves the on-disk bytes)", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run();

    const onDisk = readFileSync(path.join(outDir, "_data", "hello-world", "index.json"), "utf8");
    vi.stubGlobal("document", {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        expect(url).toBe("/_data/hello-world/index.json");
        return Promise.resolve(new Response(onDisk, { status: 200 }));
      })
    );
    const loaded = await app.data.at("/hello-world/");
    expect(loaded).toEqual(JSON.parse(onDisk));
  });

  it("#1 emits an empty {} data sidecar for a client-navigable route with no .load()", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run();

    const about = JSON.parse(
      readFileSync(path.join(outDir, "_data", "about", "index.json"), "utf8")
    );
    expect(about).toEqual({});
    // render + head still work without a loader.
    const html = readFileSync(path.join(outDir, "about", "index.html"), "utf8");
    expect(html).toContain("About");
  });

  it("#3b a loader resolves content via ctx.require(contentPlugin)", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run();

    const via = JSON.parse(
      readFileSync(path.join(outDir, "_data", "hello-world", "via", "index.json"), "utf8")
    ) as { html: string };
    expect(via.html).toContain("Hello World");
  });
});

describe("data provider — preload bundle from a real build", () => {
  // Bug: the bundle keys differ from the keys at(path) caches by (for example
  // file paths or missing trailing slashes), so the preload fills the cache
  // with keys no navigation ever asks for.
  it("preload 'all' writes _all.json with one key per per-page file", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards, { preload: "all" });
    await app.start();
    await app.build.run();

    const bundle = JSON.parse(
      readFileSync(path.join(outDir, "_data", "_all.json"), "utf8")
    ) as Record<string, unknown>;
    const keys = Object.keys(bundle);
    const written = readdirSync(path.join(outDir, "_data"), { recursive: true })
      .map(String)
      .filter(file => file.endsWith("index.json"))
      .map(file => path.join("_data", file).split(path.sep).join("/"));
    expect(keys.map(key => app.data.fileFor(key)).toSorted()).toEqual([...written].toSorted());
    expect(keys).toContain("/hello-world/");
    for (const key of keys) {
      const onDisk = readFileSync(path.join(outDir, app.data.fileFor(key)), "utf8");
      expect(bundle[key]).toEqual(JSON.parse(onDisk));
    }
  });

  // Bug: a default build starts writing the bundle, growing every deploy.
  it("a default build writes no _all.json", async () => {
    const { bySlug, cards } = await loadArticles();
    const app = makeApp(outDir, bySlug, cards);
    await app.start();
    await app.build.run();

    expect(() => readFileSync(path.join(outDir, "_data", "_all.json"))).toThrow();
  });
});
