/**
 * @file Integration scenario 4 — the future blog migration (flagship, end-to-end).
 *
 * This is the comprehensive "does the migration target actually work" check. It
 * drives the REAL `createApp` exactly as a migrating blog author would: a bilingual
 * content collection, locale-prefixed routes, structured SEO head built from the
 * exported `buildArticleHead` helper, a full SSG build, and Cloudflare deploy
 * scaffolding — asserting the complete output (pages, feed, sitemap, JSON-LD,
 * hreflang, Shiki, draft filtering, reading time) a real blog depends on.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildArticleHead,
  buildPlugin,
  contentPlugin,
  createApp,
  defineRoutes,
  deployPlugin,
  fileSystemContent,
  route
} from "../../src";
import type { Article } from "../../src/plugins/content/types";
import {
  type ArticlesByLocale,
  cleanup,
  FIXTURE_CONTENT_DIR,
  I18N,
  loadFixtureArticles,
  SITE,
  tmpDir
} from "./helpers/harness";

const LOCALES = ["en", "uk"] as const;
const POSTS = ["hello-world", "getting-started", "second-post"] as const;

/** Render pre-sanitized article HTML verbatim (delegated from the content plugin). */
function RawArticle(props: { html: string }) {
  return h("article", { dangerouslySetInnerHTML: { __html: props.html } });
}

/**
 * Construct the migrated blog through the real createApp: bilingual, locale-prefixed
 * routes whose `.head()` emits full structured SEO via `buildArticleHead`, plus the
 * deploy plugin (defaults) for scaffolding. Exactly the shape a real migration writes.
 */
function makeMigratedBlog(outDir: string, byLocale: ArticlesByLocale) {
  const pick = (locale: string, slug: string): Article | undefined =>
    (byLocale.get(locale) ?? byLocale.get("en"))?.get(slug);
  const slugs = (locale: string): string[] => [
    ...(byLocale.get(locale) ?? byLocale.get("en") ?? new Map()).keys()
  ];

  const home = route("/")
    .render(() => h("h1", {}, SITE.name))
    .head(() => ({ title: SITE.name, description: SITE.description }));

  const article = route("/{lang:?}/{slug}/")
    .generate(ctx => slugs(ctx.locale).map(slug => ({ lang: ctx.locale, slug })))
    .load(ctx => pick(ctx.locale, ctx.params.slug ?? ""))
    .render(ctx => h(RawArticle, { html: (ctx.data as Article).html }) as ReturnType<typeof h>)
    .head(ctx => {
      const a = ctx.data as Article;
      const canonicalUrl = `${SITE.url}${a.url}`;
      // Build ArticleMeta, omitting author when absent (exactOptionalPropertyTypes).
      const articleMeta: Parameters<typeof buildArticleHead>[0] = {
        title: a.frontmatter.title,
        description: a.frontmatter.description,
        published: a.frontmatter.date,
        tags: a.frontmatter.tags
      };
      if (a.frontmatter.author !== undefined) articleMeta.author = a.frontmatter.author;
      return {
        title: a.frontmatter.title,
        description: a.frontmatter.description,
        canonical: canonicalUrl,
        // Structured Article SEO (canonical + og:type + dates + tags + JSON-LD).
        elements: buildArticleHead(articleMeta, canonicalUrl)
      };
    });

  const app = createApp({
    // Node-only SSG plugins — composed by the consumer (not framework defaults).
    plugins: [contentPlugin, buildPlugin, deployPlugin],
    config: { mode: "ssg" },
    pluginConfigs: {
      site: SITE,
      i18n: { ...I18N },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_CONTENT_DIR })] },
      head: { titleTemplate: "%s — Moku Blog", twitterHandle: "@moku_labs" },
      build: {
        outDir,
        feeds: true,
        sitemap: true,
        images: false,
        ogImage: false,
        minify: false
      },
      deploy: { target: "cloudflare-pages", outDir: "dist" },
      router: { routes: defineRoutes({ home, article }) }
    }
  });
  return app;
}

describe("integration: future blog migration (end-to-end)", () => {
  let tmp: string;
  let prevCwd: string;
  let byLocale: ArticlesByLocale;

  beforeEach(async () => {
    tmp = tmpDir("int-migration-");
    prevCwd = process.cwd();
    byLocale = await loadFixtureArticles(LOCALES);
  });
  afterEach(() => {
    process.chdir(prevCwd);
    cleanup(tmp);
  });

  it("builds the complete bilingual blog (pages, feed, sitemap) and scaffolds deploy", async () => {
    const out = path.join(tmp, "dist");
    const app = makeMigratedBlog(out, byLocale);

    const result = await app.build.run();
    expect(result.pageCount).toBeGreaterThan(0);

    // Home + a page per published post per locale (second-post reaches uk via fallback).
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    for (const locale of LOCALES) {
      for (const slug of POSTS) {
        expect(existsSync(path.join(out, locale, slug, "index.html"))).toBe(true);
      }
    }
    // Draft excluded from the production migration.
    expect(existsSync(path.join(out, "en", "draft-note", "index.html"))).toBe(false);
    // Feed + sitemap generated.
    expect(existsSync(path.join(out, "feed.xml"))).toBe(true);
    expect(existsSync(path.join(out, "sitemap.xml"))).toBe(true);

    // Deploy scaffolding for the migrated blog (slug from site.name()).
    process.chdir(tmp);
    const init = await app.deploy.init({ ci: true });
    expect(init.written).toContain("wrangler.jsonc");
    expect(readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8")).toContain('"name": "moku-blog"');
  });

  it("emits full structured SEO on an article page (canonical, hreflang, JSON-LD, Shiki)", async () => {
    const out = path.join(tmp, "dist");
    await makeMigratedBlog(out, byLocale).build.run();

    const html = readFileSync(path.join(out, "en", "hello-world", "index.html"), "utf8");
    expect(html).toContain("<title>Hello World — Moku Blog</title>");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain(`${SITE.url}/en/hello-world/`);
    // hreflang alternates for both locales + x-default.
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="uk"');
    expect(html).toContain('hreflang="x-default"');
    // JSON-LD Article structured data from buildArticleHead.
    expect(html).toContain("application/ld+json");
    expect(html).toContain('"@type":"Article"');
    // Shiki-highlighted code survived the content pipeline into the page.
    expect(html).toContain("shiki");
  });

  it("computes reading time and keeps drafts out of the feed", async () => {
    // Every loaded article carries a computed reading time of at least one minute.
    for (const article of byLocale.get("en")?.values() ?? []) {
      expect(article.computed.readingTime).toBeGreaterThanOrEqual(1);
      expect(article.computed.status).toBe("published");
    }

    const out = path.join(tmp, "dist");
    await makeMigratedBlog(out, byLocale).build.run();
    const feed = readFileSync(path.join(out, "feed.xml"), "utf8");
    expect(feed).not.toContain("Draft Note");
  });
});
