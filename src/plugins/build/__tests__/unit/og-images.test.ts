import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../../../content/types";
import { validateConfig } from "../../api";
import { CONTENT_CACHE_KEY } from "../../phases/content";
import { generateOgImages, OG_CONCURRENCY, ogHash } from "../../phases/og-images";
import { makeArticle, makeCtx } from "../helpers";

/** Build a ctx with N cached published articles + an enabled (fontless) ogImage config. */
function ogCtx(tmp: string, articles: Article[]) {
  const ctx = makeCtx({
    config: { outDir: tmp, ogImage: { fontDir: "./fonts" } }
  });
  ctx.state.buildCache.set(CONTENT_CACHE_KEY, new Map([["en", articles]]));
  return ctx;
}

describe("build/phases/og-images", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-og-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("skips unchanged articles via the content-hash cache", async () => {
    const article = makeArticle({ computed: { ...makeArticle().computed, contentId: "hello" } });
    const ctx = ogCtx(tmp, [article]);
    // Pre-seed the cache with the matching hash → must skip.
    ctx.state.ogImageHashCache.set(
      "hello",
      ogHash(article.frontmatter.title, "default", { width: 1200, height: 630 })
    );
    const renderPng = vi.fn(async () => new Uint8Array([1]));

    const result = await generateOgImages(ctx, { renderPng });

    expect(renderPng).not.toHaveBeenCalled();
    expect(result?.skipped).toBe(1);
    expect(result?.rendered).toBe(0);
  });

  it("renders changed articles and writes the hash back to the cache", async () => {
    const article = makeArticle({ computed: { ...makeArticle().computed, contentId: "fresh" } });
    const ctx = ogCtx(tmp, [article]);
    const renderPng = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const result = await generateOgImages(ctx, { renderPng });

    expect(renderPng).toHaveBeenCalledTimes(1);
    expect(result?.rendered).toBe(1);
    expect(ctx.state.ogImageHashCache.get("fresh")).toBe(
      ogHash(article.frontmatter.title, "default", { width: 1200, height: 630 })
    );
  });

  it("bounds concurrency to <=4 via p-limit", async () => {
    const articles = Array.from({ length: 12 }, (_, index) =>
      makeArticle({
        frontmatter: { ...makeArticle().frontmatter, title: `Post ${index}` },
        computed: { ...makeArticle().computed, contentId: `post-${index}` }
      })
    );
    const ctx = ogCtx(tmp, articles);
    let active = 0;
    let peak = 0;
    const renderPng = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return new Uint8Array([0]);
    });

    const result = await generateOgImages(ctx, { renderPng });

    expect(renderPng).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(OG_CONCURRENCY);
    expect(result?.peakConcurrency).toBeLessThanOrEqual(OG_CONCURRENCY);
  });

  it("is a no-op when config.ogImage is false", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, ogImage: false } });
    expect(await generateOgImages(ctx)).toBeNull();
  });

  it("surfaces the font-validation error path (validateConfig, onInit)", () => {
    const noFonts = mkdtempSync(path.join(tmpdir(), "og-nofonts-"));
    try {
      expect(() =>
        validateConfig({
          outDir: "./dist",
          minify: true,
          feeds: true,
          sitemap: true,
          images: true,
          ogImage: { fontDir: noFonts }
        })
      ).toThrowError(/\[web\] build\.ogImage/);
    } finally {
      rmSync(noFonts, { recursive: true, force: true });
    }
  });
});
