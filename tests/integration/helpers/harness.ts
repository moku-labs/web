/**
 * @file Shared harness for the framework-level integration scenarios.
 *
 * These tests deliberately drive the REAL exported `createApp` from the framework
 * barrel (`src/index.ts`) — the shipped consumer entry point with the canonical
 * 8-plugin regular array plus the `log`/`env` core plugins. The per-plugin suites
 * under `src/plugins/*​/__tests__/` rebuild a private `createCoreConfig("web-test")`
 * core to isolate one plugin; this harness exercises the actual wiring a consumer
 * (e.g. the future blog migration) would import and use.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { h } from "preact";
import {
  buildPlugin,
  contentPlugin,
  createApp,
  defineRoutes,
  deployPlugin,
  fileSystemContent,
  route
} from "../../../src";
import type { Article } from "../../../src/plugins/content/types";

/**
 * Absolute path to the synthetic blog fixture (content layout: `{slug}/{locale}.md`).
 * Resolved from `process.cwd()` (the repo root under vitest) rather than
 * `import.meta.url` so the harness loads under both node and happy-dom — happy-dom
 * rewrites `import.meta.url` to a non-`file:` URL that `fileURLToPath` rejects.
 */
export const FIXTURE_CONTENT_DIR = path.resolve(
  process.cwd(),
  "tests/integration/fixtures/blog/content"
);

/** A complete, valid site config shared across every scenario. */
export const SITE = {
  name: "Moku Blog",
  url: "https://blog.moku.dev",
  author: "Moku Labs",
  description: "The Moku Labs engineering blog."
} as const;

/** Bilingual i18n config (en default + uk) used by the multi-locale scenarios. */
export const I18N = {
  locales: ["en", "uk"],
  defaultLocale: "en",
  localeNames: { en: "English", uk: "Українська" },
  ogLocaleMap: { en: "en_US", uk: "uk_UA" },
  translations: {
    en: { "nav.home": "Home" },
    uk: { "nav.home": "Головна" }
  }
} as const;

/** Create a unique temp directory under the OS tmpdir. */
export function tmpDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Recursively remove a temp directory (best-effort; never throws). */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A preloaded fixture set: locale -> (slug -> Article). */
export type ArticlesByLocale = Map<string, Map<string, Article>>;

/** Render pre-sanitized article HTML verbatim (delegated from the content plugin). */
function RawArticle(props: { html: string }) {
  return h("article", { dangerouslySetInnerHTML: { __html: props.html } });
}

/**
 * Preload every fixture article through the REAL content plugin, returning a
 * locale -> (slug -> Article) map. Drafts are excluded in production mode by the
 * content plugin itself. Route loaders close over this so the build never re-reads
 * disk per page (mirrors the per-plugin build suite's preload pattern).
 *
 * @param locales - Locales to load (first entry is treated as the default).
 * @param mode - Framework mode. `"development"` keeps drafts; `"production"` (default) drops them.
 * @returns A locale-keyed map of slug -> Article.
 * @example
 * const byLocale = await loadFixtureArticles(["en", "uk"]);
 */
export async function loadFixtureArticles(
  locales: readonly string[] = ["en"],
  mode: "production" | "development" = "production"
): Promise<ArticlesByLocale> {
  const app = createApp({
    // content is node-only — added explicitly (not a framework default).
    plugins: [contentPlugin],
    config: { isDevelopment: mode === "development" },
    pluginConfigs: {
      site: SITE,
      i18n: { locales: [...locales], defaultLocale: locales[0] ?? "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_CONTENT_DIR })] }
    }
  });
  const byLocale = await app.content.loadAll();
  const out: ArticlesByLocale = new Map();
  for (const [locale, articles] of byLocale) {
    const bySlug = new Map<string, Article>();
    for (const article of articles) bySlug.set(article.computed.slug, article);
    out.set(locale, bySlug);
  }
  return out;
}

/** Look up a preloaded article by locale + slug, falling back to the en set. */
function pick(byLocale: ArticlesByLocale, locale: string, slug: string): Article | undefined {
  return (byLocale.get(locale) ?? byLocale.get("en"))?.get(slug);
}

/** Slugs available for a locale (falls back to the en set). */
function slugsFor(byLocale: ArticlesByLocale, locale: string): string[] {
  return [...(byLocale.get(locale) ?? byLocale.get("en") ?? new Map()).keys()];
}

/**
 * Build the home + article route map for a preloaded fixture set. When `localized`
 * is true the article pattern carries an optional `{lang:?}` segment and generates
 * one instance per locale; otherwise it is a single-locale `/{slug}/`.
 *
 * @param byLocale - Preloaded articles keyed by locale then slug.
 * @param localized - Whether to emit locale-prefixed routes.
 * @returns A `defineRoutes` map ready for `pluginConfigs.router.routes`.
 * @example
 * const routes = blogRoutes(byLocale, true);
 */
export function blogRoutes(byLocale: ArticlesByLocale, localized: boolean) {
  const home = route("/")
    .render(() => h("h1", {}, SITE.name))
    .head(() => ({ title: SITE.name }));

  if (localized) {
    const article = route("/{lang:?}/{slug}/")
      .generate(ctx => slugsFor(byLocale, ctx.locale).map(slug => ({ lang: ctx.locale, slug })))
      .load(ctx => pick(byLocale, ctx.locale, ctx.params.slug ?? ""))
      .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
      .head(ctx => ({
        title: (ctx.data as Article).frontmatter.title,
        description: (ctx.data as Article).frontmatter.description
      }));
    return defineRoutes({ home, article });
  }

  const article = route("/{slug}/")
    .generate(ctx => slugsFor(byLocale, ctx.locale).map(slug => ({ slug })))
    .load(ctx => pick(byLocale, ctx.locale, ctx.params.slug ?? ""))
    .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
    .head(ctx => ({
      title: (ctx.data as Article).frontmatter.title,
      description: (ctx.data as Article).frontmatter.description
    }));
  return defineRoutes({ home, article });
}

/**
 * Construct the full SSG blog app through the REAL `createApp`: site + i18n +
 * router(ssg) + content + head + build, over a temp `outDir`. Logs are silenced
 * via `log.mode: "test"`. The remaining framework plugins (spa, deploy) sit at
 * their defaults — exactly what a consumer that only builds a static site gets.
 *
 * @param options - The build configuration.
 * @param options.outDir - Temp output directory the site is written to.
 * @param options.byLocale - Preloaded articles keyed by locale then slug.
 * @param options.locales - Locales to build (first entry is the default). Defaults to `["en"]`.
 * @param options.localized - Force locale-prefixed routes. Defaults to `locales.length > 1`.
 * @param options.mode - Framework mode. `"development"` keeps drafts; `"production"` (default) drops them.
 * @returns The constructed app (call `await app.build.run()` to produce the site).
 * @example
 * const app = buildBlogApp({ outDir, byLocale, locales: ["en", "uk"] });
 * await app.build.run();
 */
export function buildBlogApp(options: {
  outDir: string;
  byLocale: ArticlesByLocale;
  locales?: readonly string[];
  localized?: boolean;
  mode?: "production" | "development";
}) {
  const locales = options.locales ?? ["en"];
  const localized = options.localized ?? locales.length > 1;
  const app = createApp({
    // Node-only SSG plugins — composed by the consumer (not framework defaults).
    plugins: [contentPlugin, buildPlugin, deployPlugin],
    config: { isDevelopment: (options.mode ?? "production") === "development", mode: "ssg" },
    pluginConfigs: {
      site: SITE,
      i18n: { ...I18N, locales: [...locales], defaultLocale: locales[0] ?? "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_CONTENT_DIR })] },
      head: { titleTemplate: "%s — Moku Blog", twitterHandle: "@moku_labs" },
      build: {
        outDir: options.outDir,
        feeds: true,
        sitemap: true,
        images: false,
        ogImage: false,
        minify: false
      },
      router: { routes: blogRoutes(options.byLocale, localized) }
    }
  });
  return app;
}
