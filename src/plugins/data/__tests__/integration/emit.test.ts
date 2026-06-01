import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlugin } from "../../../build";
import { contentPlugin } from "../../../content";
import type { Article } from "../../../content/types";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { dataPlugin } from "../../index";
import type { RouteIndexFile, SidecarFragment } from "../../types";

/** Fixture: one published article (`hello-world`) + one draft (`secret-draft`). */
const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));
const SITE = {
  name: "Data Test",
  url: "https://data.dev",
  author: "Tester",
  description: "Isomorphic bridge fixture site"
};

/** Render pre-sanitized article HTML verbatim. */
function RawArticle(props: { html: string }) {
  return h("article", { dangerouslySetInnerHTML: { __html: props.html } });
}

/** Preload the production-filtered article set (drafts excluded) for route loaders. */
async function loadArticles(): Promise<Map<string, Article>> {
  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
    plugins: [i18nPlugin, contentPlugin],
    pluginConfigs: {
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { contentDir: FIXTURE_DIR }
    }
  });
  const bySlug = new Map<string, Article>();
  const byLocale = await app.content.loadAll();
  for (const article of byLocale.get("en") ?? []) {
    bySlug.set(article.computed.slug, article);
  }
  return bySlug;
}

/** Compose the full SSG app with the data bridge plugin over a tmp outDir. */
function makeApp(outDir: string, bySlug: Map<string, Article>) {
  const articleRoute = route("/{slug}/")
    .generate(() => [...bySlug.keys()].map(slug => ({ slug })))
    .load(({ slug }) => bySlug.get(slug ?? ""))
    .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
    .head(ctx => ({ title: (ctx.data as Article).frontmatter.title }));
  const homeRoute = route("/")
    .render(() => h("h1", {}, "Home"))
    .head(() => ({ title: "Home" }));
  const routes = defineRoutes({ home: homeRoute, article: articleRoute });

  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
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
      router: { routes, mode: "hybrid" as const },
      content: { contentDir: FIXTURE_DIR },
      build: { outDir, feeds: false, sitemap: false, images: false, ogImage: false, minify: false }
    }
  });
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "moku-data-int-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("data bridge — build → emit integration", () => {
  it("emits a parseable manifest + fragment sidecars from the real build output", async () => {
    const bySlug = await loadArticles();
    const app = makeApp(outDir, bySlug);
    await app.start();
    await app.build.run();
    const summary = await app.data.emit({ outDir });

    const manifest: RouteIndexFile = JSON.parse(
      readFileSync(path.join(outDir, "_data", "routes-manifest.json"), "utf8")
    );
    expect(summary.sidecarCount).toBe(manifest.routes.length);
    expect(manifest.routes.length).toBeGreaterThan(0);

    const hello = manifest.routes.find(r => r.pattern === "/hello-world/");
    if (!hello) throw new Error("expected a /hello-world/ manifest route");
    const sidecar: SidecarFragment = JSON.parse(
      readFileSync(path.join(outDir, "_data", hello.dataUrl.replace("/_data/", "")), "utf8")
    );
    expect(sidecar.html).toContain("Hello World");
  });

  it("draft-safety gate: a production emit leaks ZERO draft data", async () => {
    const bySlug = await loadArticles();
    const app = makeApp(outDir, bySlug);
    await app.start();
    await app.build.run();
    await app.data.emit({ outDir });

    const dataDir = path.join(outDir, "_data");
    const combined = readdirSync(dataDir)
      .map(name => readFileSync(path.join(dataDir, name), "utf8"))
      .join("\n");
    expect(combined).not.toContain("secret-draft");
    expect(combined).not.toContain("Secret Draft");
    expect(combined.toLowerCase()).not.toContain("must never be emitted");
  });
});
