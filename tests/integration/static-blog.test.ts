/**
 * @file Integration scenario 1 — a static blog through the real `createApp`.
 *
 * Drives the shipped framework barrel end-to-end: site + i18n + router + content +
 * head + build → a real `dist/` tree on disk. Asserts page output, SEO `<head>`
 * composition, RSS/Atom feed, sitemap, and production draft filtering.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ArticlesByLocale,
  buildBlogApp,
  cleanup,
  loadFixtureArticles,
  SITE,
  tmpDir
} from "./helpers/harness";

describe("integration: static blog (SSG + SEO/feeds)", () => {
  let tmp: string;
  let byLocale: ArticlesByLocale;

  beforeEach(async () => {
    tmp = tmpDir("int-static-blog-");
    byLocale = await loadFixtureArticles(["en"]);
  });
  afterEach(() => cleanup(tmp));

  it("builds a dist/ tree with a home page and a page per published post", async () => {
    const out = path.join(tmp, "dist");
    const app = buildBlogApp({ outDir: out, byLocale, locales: ["en"] });
    const result = await app.build.run();

    expect(result.outDir).toBe(out);
    expect(result.pageCount).toBeGreaterThan(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    for (const slug of byLocale.get("en")?.keys() ?? []) {
      expect(existsSync(path.join(out, slug, "index.html"))).toBe(true);
    }
  });

  it("excludes the draft post from the production build", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: ["en"] }).build.run();

    // The content plugin drops drafts in production, so it never reaches a page.
    expect(byLocale.get("en")?.has("draft-note")).toBe(false);
    expect(existsSync(path.join(out, "draft-note", "index.html"))).toBe(false);
  });

  it("includes the draft post in a development/preview build (mode override)", async () => {
    // A development build keeps drafts so authors can preview unpublished work —
    // the inverse of the production filtering above, driven by `config.mode`.
    const devArticles = await loadFixtureArticles(["en"], "development");
    expect(devArticles.get("en")?.has("draft-note")).toBe(true);

    const out = path.join(tmp, "dist");
    await buildBlogApp({
      outDir: out,
      byLocale: devArticles,
      locales: ["en"],
      mode: "development"
    }).build.run();
    expect(existsSync(path.join(out, "draft-note", "index.html"))).toBe(true);
  });

  it("renders article markdown (headings + Shiki-highlighted code) into the page", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: ["en"] }).build.run();

    const html = readFileSync(path.join(out, "hello-world", "index.html"), "utf8");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello World");
    // Shiki emits a class="shiki ..." wrapper on highlighted code blocks.
    expect(html).toContain("shiki");
  });

  it("composes the SEO <head>: templated title, canonical, og + twitter", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: ["en"] }).build.run();

    const html = readFileSync(path.join(out, "hello-world", "index.html"), "utf8");
    // titleTemplate "%s — Moku Blog" applied to the route title.
    expect(html).toContain("<title>Hello World — Moku Blog</title>");
    // Canonical + Open Graph + Twitter tags from the head plugin.
    expect(html).toContain('rel="canonical"');
    expect(html).toContain(`${SITE.url}/hello-world/`);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
  });

  it("writes a feed.xml whose entries match the published article set", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: ["en"] }).build.run();

    const xml = readFileSync(path.join(out, "feed.xml"), "utf8");
    const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(m => m[1]);
    const expected = [...(byLocale.get("en")?.values() ?? [])].map(a => `${SITE.url}${a.url}`);
    expect(guids.toSorted()).toEqual(expected.toSorted());
    // The draft must not appear in the feed.
    expect(xml).not.toContain("Draft Note");
  });

  it("writes a sitemap.xml whose URL set matches the route manifest expansion", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: ["en"] }).build.run();

    const xml = readFileSync(path.join(out, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const expected = [
      SITE.url,
      ...[...(byLocale.get("en")?.keys() ?? [])].map(s => `${SITE.url}/${s}/`)
    ];
    expect(locs.toSorted()).toEqual(expected.toSorted());
  });
});
