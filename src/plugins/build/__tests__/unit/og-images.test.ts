import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../../../content/types";
import { validateConfig } from "../../api";
import { CONTENT_CACHE_KEY } from "../../phases/content";
import {
  fontsKey,
  generateOgImages,
  loadFonts,
  OG_CONCURRENCY,
  ogHash
} from "../../phases/og-images";
import type { RichOgInput } from "../../types";
import { makeArticle, makeCtx } from "../helpers";

/** Build the RichOgInput the phase derives for a given article (default template/size). */
function inputFor(title: string): RichOgInput {
  return {
    title,
    description: "Intro",
    date: "2026-01-15",
    tags: [],
    locale: "en",
    siteName: "",
    size: { width: 1200, height: 630 }
  };
}

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
    ctx.state.ogImageHashCache.set("hello", ogHash(inputFor("Hello World"), "default", fontsKey()));
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
      ogHash(inputFor("Hello World"), "default", fontsKey())
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

  it("GATE: changing any RichOgInput field changes ogHash (cache invalidation)", () => {
    const base = ogHash(inputFor("Title"), "default", fontsKey());
    const fk = fontsKey();
    expect(ogHash({ ...inputFor("Title"), title: "Other" }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), description: "x" }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), date: "2030-01-01" }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), tags: ["new"] }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), author: "A" }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), locale: "uk" }, "default", fk)).not.toBe(base);
    expect(ogHash({ ...inputFor("Title"), siteName: "Other" }, "default", fk)).not.toBe(base);
    expect(
      ogHash({ ...inputFor("Title"), size: { width: 800, height: 600 } }, "default", fk)
    ).not.toBe(base);
    // Identical input + fonts reuses the same hash.
    expect(ogHash(inputFor("Title"), "default", fk)).toBe(base);
  });

  it("GATE: changing the fonts list changes ogHash (cache invalidation)", () => {
    const base = ogHash(inputFor("Title"), "default", fontsKey());
    const withFont = ogHash(
      inputFor("Title"),
      "default",
      fontsKey([{ name: "Inter", path: "./fonts/Inter.ttf", weight: 600 }])
    );
    expect(withFont).not.toBe(base);
    // Same fonts list → same key.
    expect(fontsKey([{ name: "Inter", path: "./fonts/Inter.ttf" }])).toBe(
      fontsKey([{ name: "Inter", path: "./fonts/Inter.ttf" }])
    );
  });

  it("reaches the configured ogImage.render hook (RichOgInput passed)", async () => {
    const article = makeArticle({ computed: { ...makeArticle().computed, contentId: "rich" } });
    const ctx = makeCtx({ config: { outDir: tmp, ogImage: { fontDir: "./fonts" } } });
    ctx.state.buildCache.set(CONTENT_CACHE_KEY, new Map([["en", [article]]]));
    let seen: RichOgInput | undefined;
    const og = ctx.config.ogImage;
    if (og) {
      og.render = input => {
        seen = input;
        return { type: "div", props: {}, key: undefined } as never;
      };
    }
    // Inject a fake rasterizer so we never touch satori/resvg.
    const renderPng = vi.fn(async (input: RichOgInput) => {
      seen = input;
      return new Uint8Array([1]);
    });

    const result = await generateOgImages(ctx, { renderPng });

    expect(result?.rendered).toBe(1);
    expect(seen?.title).toBe("Hello World");
    expect(seen?.size).toEqual({ width: 1200, height: 630 });
  });

  it("loads each configured font path exactly once (multi-font, outside the per-image loop)", async () => {
    const fontA = path.join(tmp, "A.ttf");
    const fontB = path.join(tmp, "B.ttf");
    writeFileSync(fontA, "fontA-bytes");
    writeFileSync(fontB, "fontB-bytes");
    const loaded = await loadFonts({
      fontDir: tmp,
      fonts: [
        { name: "A", path: fontA, weight: 400 },
        { name: "B", path: fontB, weight: 700, style: "italic" }
      ]
    });
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.name).toBe("A");
    expect(loaded[1]?.name).toBe("B");
    expect(loaded[1]?.weight).toBe(700);
    expect(loaded[1]?.style).toBe("italic");
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
