/**
 * @file build phase 4 — og-images. Renders one OG image per published article via
 * Satori → SVG → resvg → PNG, bounded by `p-limit(4)`, with a persisted
 * content-hash cache (`<outDir>/.cache/og-images.json`) skipping unchanged articles.
 * Gated by config.ogImage (object enables; false disables).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { Article } from "../../content/types";
import type { OgImageConfig, OgPngRenderer, PhaseContext } from "../types";
import { readCachedContent } from "./content";

/** Default OG image dimensions when `size` is omitted. */
const DEFAULT_SIZE = { width: 1200, height: 630 } as const;
/** The fixed concurrency bound for the OG render pool. */
export const OG_CONCURRENCY = 4;
/** Recognized font file extensions. */
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff"] as const;

/**
 * Result of the og-images phase — counts of rendered vs. cache-skipped articles
 * plus the peak observed render concurrency (asserted by tests).
 *
 * @example
 * ```ts
 * const result: OgImagesResult = { rendered: 2, skipped: 1, peakConcurrency: 2 };
 * ```
 */
export type OgImagesResult = {
  /** Number of articles rasterized this run. */
  rendered: number;
  /** Number of articles skipped via the content-hash cache. */
  skipped: number;
  /** Peak observed concurrent renders (never exceeds {@link OG_CONCURRENCY}). */
  peakConcurrency: number;
};

/** The optional dependency-injection seam for {@link generateOgImages}. */
export type OgImagesOptions = {
  /** Override the PNG renderer (defaults to the real Satori → resvg pipeline). */
  renderPng?: OgPngRenderer;
};

/**
 * Compute the content-hash cache key for an article: `sha256(title+template+size)`.
 *
 * @param title - The article title.
 * @param template - The resolved OG template identifier.
 * @param size - The output dimensions.
 * @returns The hex-encoded SHA-256 digest.
 * @example
 * ```ts
 * ogHash("Hello", "default", { width: 1200, height: 630 });
 * ```
 */
export function ogHash(
  title: string,
  template: string,
  size: { width: number; height: number }
): string {
  return createHash("sha256")
    .update(`${title}|${template}|${size.width}x${size.height}`)
    .digest("hex");
}

/**
 * Resolve the first font file in `fontDir` and read its bytes for Satori.
 *
 * @param fontDir - Directory containing at least one font file.
 * @returns The font name + bytes, or `null` when no font is present.
 * @example
 * ```ts
 * await loadFont("./fonts");
 * ```
 */
async function loadFont(fontDir: string): Promise<{ name: string; data: Buffer } | undefined> {
  if (!existsSync(fontDir)) return undefined;
  const entries = await readdir(fontDir);
  const font = entries.find(name => FONT_EXTENSIONS.some(extension => name.endsWith(extension)));
  if (!font) return undefined;
  return { name: "OG", data: await readFile(path.join(fontDir, font)) };
}

/**
 * The default PNG renderer: Satori renders a card to SVG, resvg rasterizes to PNG.
 *
 * @param ctx - The font directory + template wiring for the renderer.
 * @param ctx.fontDir - Directory containing at least one font file.
 * @returns An {@link OgPngRenderer} bound to the loaded font.
 * @example
 * ```ts
 * const render = makeDefaultRenderer({ fontDir: "./fonts" });
 * ```
 */
function makeDefaultRenderer(ctx: { fontDir: string }): OgPngRenderer {
  // Load the font ONCE for the whole render pass (the promise is awaited per
  // article but the disk read happens a single time), not once per article.
  const fontPromise = loadFont(ctx.fontDir);
  return async ({ title, width, height }) => {
    const font = await fontPromise;
    if (!font) throw new Error("[web] build.ogImage no font available for rendering");
    const svg = await satori(
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 64,
          background: "#0b0b0c",
          color: "#ffffff"
        }}
      >
        {title}
      </div>,
      { width, height, fonts: [{ name: font.name, data: font.data, weight: 400, style: "normal" }] }
    );
    return new Resvg(svg).render().asPng();
  };
}

/**
 * Select the published articles to render OG images for (default-locale set).
 *
 * @param byLocale - The cached locale-keyed article map.
 * @returns The published articles across the first cached locale.
 * @example
 * ```ts
 * selectArticles(byLocale);
 * ```
 */
function selectArticles(byLocale: Map<string, Article[]>): Article[] {
  const first = [...byLocale.values()][0] ?? [];
  return first.filter(article => article.computed.status === "published");
}

/**
 * Renders OG images for published articles with a `p-limit(4)` concurrency pool.
 * Computes `sha256(title+template+size)` per article and skips regeneration when
 * the hash matches `state.ogImageHashCache`; writes the cache back to
 * `<outDir>/.cache/og-images.json`. No-op when `config.ogImage` is false.
 *
 * @param ctx - Plugin context (provides `state`, `config`, `log`).
 * @param options - Optional dependency-injection seam (PNG renderer).
 * @returns The render/skip counts + peak concurrency, or `null` when disabled.
 * @example
 * ```ts
 * const result = await generateOgImages(ctx);
 * ```
 */
export async function generateOgImages(
  ctx: Pick<PhaseContext, "state" | "config" | "log">,
  options: OgImagesOptions = {}
): Promise<OgImagesResult | null> {
  const og = ctx.config.ogImage;
  if (!og) {
    ctx.log.debug("build:og-images", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }
  const { default: pLimit } = await import("p-limit");
  const size = (og as OgImageConfig).size ?? DEFAULT_SIZE;
  const template = (og as OgImageConfig).template ?? "default";
  const renderPng = options.renderPng ?? makeDefaultRenderer({ fontDir: og.fontDir });
  const articles = selectArticles(readCachedContent(ctx as Pick<PhaseContext, "state">));
  const cache = ctx.state.ogImageHashCache;
  await loadDiskCache(ctx.config.outDir, cache);

  const limit = pLimit(OG_CONCURRENCY);
  let active = 0;
  let peakConcurrency = 0;
  let rendered = 0;
  let skipped = 0;
  const outDir = path.join(ctx.config.outDir, "og");

  await Promise.all(
    articles.map(article =>
      limit(async () => {
        const key = article.computed.contentId;
        const hash = ogHash(article.frontmatter.title, template, size);
        if (cache.get(key) === hash) {
          skipped += 1;
          return;
        }
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        try {
          const png = await renderPng({ title: article.frontmatter.title, ...size });
          await mkdir(outDir, { recursive: true });
          await writeFile(path.join(outDir, `${key}.png`), png);
          cache.set(key, hash);
          rendered += 1;
        } finally {
          active -= 1;
        }
      })
    )
  );

  await persistDiskCache(ctx.config.outDir, cache);
  ctx.log.debug("build:og-images", { rendered, skipped });
  return { rendered, skipped, peakConcurrency };
}

/**
 * Load the persisted OG hash cache from `<outDir>/.cache/og-images.json` into the
 * in-memory map (missing/corrupt cache is treated as empty).
 *
 * @param outDir - The build output directory.
 * @param cache - The in-memory hash cache to populate.
 * @example
 * ```ts
 * await loadDiskCache("./dist", cache);
 * ```
 */
async function loadDiskCache(outDir: string, cache: Map<string, string>): Promise<void> {
  const file = path.join(outDir, ".cache", "og-images.json");
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) cache.set(key, value);
  } catch {
    // Corrupt cache — treat as empty; it will be rewritten this run.
  }
}

/**
 * Persist the in-memory OG hash cache to `<outDir>/.cache/og-images.json`.
 *
 * @param outDir - The build output directory.
 * @param cache - The in-memory hash cache to serialize.
 * @example
 * ```ts
 * await persistDiskCache("./dist", cache);
 * ```
 */
async function persistDiskCache(outDir: string, cache: Map<string, string>): Promise<void> {
  const dir = path.join(outDir, ".cache");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "og-images.json"),
    JSON.stringify(Object.fromEntries(cache)),
    "utf8"
  );
}
