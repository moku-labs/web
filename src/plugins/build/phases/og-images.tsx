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
import { h, type VNode } from "preact";
import type { Article } from "../../content/types";
import { i18nPlugin } from "../../i18n";
import { sitePlugin } from "../../site";
import type { OgFont, OgImageConfig, PhaseContext, RichOgInput } from "../types";
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

/**
 * Injectable PNG renderer for the og-images phase. Defaults to the real
 * Satori → resvg pipeline; unit tests inject a fake to assert hash-cache skip
 * and the `p-limit` bound without rasterizing real images.
 *
 * @example
 * ```ts
 * const render: OgPngRenderer = async () => new Uint8Array();
 * ```
 */
export type OgPngRenderer = (input: RichOgInput) => Promise<Uint8Array>;

/** The optional dependency-injection seam for {@link generateOgImages}. */
export type OgImagesOptions = {
  /** Override the PNG renderer (defaults to the real Satori → resvg pipeline). */
  renderPng?: OgPngRenderer;
};

/**
 * A loaded Satori font: a family name, raw bytes, and weight/style. Built once per
 * build (outside the per-image loop) from either `ogImage.fonts` or the `fontDir` scan.
 *
 * @example
 * ```ts
 * const font: LoadedFont = { name: "OG", data: Buffer.from(""), weight: 400, style: "normal" };
 * ```
 */
export type LoadedFont = {
  /** Font family name. */
  name: string;
  /** Raw font bytes. */
  data: Buffer;
  /** Numeric weight. */
  weight: number;
  /** Font style. */
  style: "normal" | "italic";
};

/**
 * Compute a stable cache key for the `fonts` configuration so a font change
 * invalidates cached PNGs. Hashes the name/path/weight/style of each entry (order
 * preserved); an empty/omitted list yields a fixed sentinel.
 *
 * @param fonts - The configured OG fonts (optional).
 * @returns A short stable key derived from the fonts list.
 * @example
 * ```ts
 * fontsKey([{ name: "Inter", path: "./Inter.ttf" }]);
 * ```
 */
export function fontsKey(fonts?: readonly OgFont[]): string {
  if (!fonts || fonts.length === 0) return "default-font";
  const parts = fonts.map(
    font => `${font.name}:${font.path}:${font.weight ?? 400}:${font.style ?? "normal"}`
  );
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * Compute the content-hash cache key for an article OG image. Covers the FULL
 * {@link RichOgInput} (title/description/date/tags/author/locale/siteName/size),
 * the resolved `template`, and a {@link fontsKey} of the fonts list — so changing
 * any input field OR the fonts invalidates the cached PNG.
 *
 * @param input - The full rich OG input for the card.
 * @param template - The resolved OG template identifier.
 * @param fontsHash - The {@link fontsKey} of the configured fonts.
 * @returns The hex-encoded SHA-256 digest.
 * @example
 * ```ts
 * ogHash(input, "default", fontsKey());
 * ```
 */
export function ogHash(input: RichOgInput, template: string, fontsHash: string): string {
  const payload = [
    input.title,
    input.description,
    input.date,
    input.tags.join(","),
    input.author ?? "",
    input.locale,
    input.siteName,
    `${input.size.width}x${input.size.height}`,
    template,
    fontsHash
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Load the configured OG fonts ONCE per build. When `ogImage.fonts` is set, each
 * `path` is read to a Buffer (outside any per-image loop) and mapped to a Satori
 * font entry; otherwise the first font file found in `fontDir` is used as a single
 * 400/normal fallback.
 *
 * @param og - The font directory + optional explicit fonts list.
 * @param og.fontDir - Directory scanned for a fallback font when `fonts` is unset.
 * @param og.fonts - Explicit named fonts (each loaded once).
 * @returns The loaded fonts (empty when no font is available).
 * @example
 * ```ts
 * await loadFonts({ fontDir: "./fonts" });
 * ```
 */
export async function loadFonts(og: {
  fontDir: string;
  fonts?: readonly OgFont[];
}): Promise<LoadedFont[]> {
  if (og.fonts && og.fonts.length > 0) {
    return Promise.all(
      og.fonts.map(async font => ({
        name: font.name,
        data: await readFile(font.path),
        weight: font.weight ?? 400,
        style: font.style ?? "normal"
      }))
    );
  }
  if (!existsSync(og.fontDir)) return [];
  const entries = await readdir(og.fontDir);
  const file = entries.find(name => FONT_EXTENSIONS.some(extension => name.endsWith(extension)));
  if (!file) return [];
  return [
    { name: "OG", data: await readFile(path.join(og.fontDir, file)), weight: 400, style: "normal" }
  ];
}

/**
 * The built-in default OG card — a centered title on a dark background. Used when
 * no custom `ogImage.render` hook is configured. (`@jsxImportSource preact`.)
 *
 * @param input - The rich OG input (only `title` is used by the default card).
 * @returns The Preact `VNode` for the default card.
 * @example
 * ```ts
 * defaultCard(input);
 * ```
 */
function defaultCard(input: RichOgInput): VNode {
  return h(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 64,
        background: "#0b0b0c",
        color: "#ffffff"
      }
    },
    input.title
    // h() infers a precise prop-typed VNode; the public hook contract is the
    // generic `VNode`, so widen it here (sound — only the node shape crosses).
  ) as VNode;
}

/**
 * The default PNG renderer: a Preact `VNode` (custom `render` hook or the built-in
 * card) is rendered to SVG by Satori, then rasterized to PNG by resvg. Both native
 * deps are imported LAZILY (browser-safe goal); the VNode→Satori-input cast happens
 * at this single framework boundary only.
 *
 * @param ctx - The renderer wiring (preloaded fonts + optional custom card).
 * @param ctx.fonts - Fonts loaded once for the whole render pass.
 * @param ctx.render - Optional custom card renderer; defaults to {@link defaultCard}.
 * @returns An {@link OgPngRenderer} bound to the loaded fonts + renderer.
 * @example
 * ```ts
 * const render = makeDefaultRenderer({ fonts, render: undefined });
 * ```
 */
function makeDefaultRenderer(ctx: {
  fonts: LoadedFont[];
  render?: (input: RichOgInput) => VNode;
}): OgPngRenderer {
  return async input => {
    if (ctx.fonts.length === 0) {
      throw new Error("[web] build.ogImage no font available for rendering");
    }
    const { default: satori } = await import("satori");
    const { Resvg } = await import("@resvg/resvg-js");
    const card = (ctx.render ?? defaultCard)(input);
    // Single framework boundary: cast the Preact VNode + loaded fonts to Satori's
    // input shapes (LoadedFont is structurally Satori's FontOptions).
    const options = {
      width: input.size.width,
      height: input.size.height,
      fonts: ctx.fonts
    } as unknown as Parameters<typeof satori>[1];
    const svg = await satori(card as unknown as Parameters<typeof satori>[0], options);
    return new Resvg(svg).render().asPng();
  };
}

/**
 * Select the published articles to render OG images for — the default-locale set
 * (mirrors `feeds.ts`: OG cards are single-locale by convention, keyed to the
 * default locale rather than whatever locale happens to be cached first).
 *
 * @param byLocale - The cached locale-keyed article map.
 * @param defaultLocale - The default locale code from i18n.
 * @returns The published default-locale articles.
 * @example
 * ```ts
 * selectArticles(byLocale, "en");
 * ```
 */
function selectArticles(byLocale: Map<string, Article[]>, defaultLocale: string): Article[] {
  const articles = byLocale.get(defaultLocale) ?? [];
  return articles.filter(article => article.computed.status === "published");
}

/**
 * Build the {@link RichOgInput} for one article from its frontmatter/computed
 * fields plus the resolved size and site name.
 *
 * @param article - The published article to render a card for.
 * @param size - The resolved OG output dimensions.
 * @param size.width - The OG image width in pixels.
 * @param size.height - The OG image height in pixels.
 * @param siteName - The site name (from the site plugin, or `""` when unavailable).
 * @returns The fully-populated rich OG input.
 * @example
 * ```ts
 * buildInput(article, { width: 1200, height: 630 }, "Blog");
 * ```
 */
function buildInput(
  article: Article,
  size: { width: number; height: number },
  siteName: string
): RichOgInput {
  const input: RichOgInput = {
    title: article.frontmatter.title,
    description: article.frontmatter.description,
    date: article.frontmatter.date,
    tags: [...article.frontmatter.tags],
    locale: article.locale,
    siteName,
    size
  };
  if (article.frontmatter.author !== undefined) input.author = article.frontmatter.author;
  return input;
}

/**
 * Resolve the site name via `ctx.require(sitePlugin)`, falling back to `""` when the
 * site API is unavailable (e.g. unit mocks that omit it).
 *
 * @param ctx - Plugin context (provides `require`).
 * @returns The site name, or `""` when the site plugin is not wired.
 * @example
 * ```ts
 * resolveSiteName(ctx);
 * ```
 */
function resolveSiteName(ctx: Pick<PhaseContext, "require">): string {
  try {
    return ctx.require(sitePlugin).name();
  } catch {
    return "";
  }
}

/**
 * The mutable accumulator threaded through every per-article render task: the
 * render/skip counts returned by the phase plus the live concurrency tracker
 * ({@link RenderTally.active} rises/falls around each render so {@link
 * RenderTally.peakConcurrency} captures the high-water mark across the pool).
 *
 * @example
 * ```ts
 * const tally: RenderTally = { rendered: 0, skipped: 0, active: 0, peakConcurrency: 0 };
 * ```
 */
type RenderTally = {
  /** Number of articles rasterized so far. */
  rendered: number;
  /** Number of articles skipped via the content-hash cache. */
  skipped: number;
  /** Renders currently in flight (rises/falls around each rasterization). */
  active: number;
  /** Peak observed value of {@link RenderTally.active}. */
  peakConcurrency: number;
};

/**
 * Render (or cache-skip) one article's OG image, mutating {@link RenderTally} in
 * place. A matching cached hash bumps `skipped` and returns early; otherwise the
 * PNG is rasterized to `<outDir>/og/<slug>.png`, the cache entry is updated, and
 * `rendered` is bumped — with `active`/`peakConcurrency` bracketing the render so
 * the pool's high-water mark is observed even if rasterization throws.
 *
 * @param article - The published article to render a card for.
 * @param deps - The shared per-pass render wiring.
 * @param deps.renderPng - The bound PNG rasterizer (DI seam or default pipeline).
 * @param deps.input - The article's {@link RichOgInput} card payload.
 * @param deps.hash - The article's content-hash cache value ({@link ogHash}).
 * @param deps.cache - The in-memory hash cache (read for skip, written on render).
 * @param deps.outDir - The `og` output directory the PNG is written into.
 * @param tally - The mutable counts + concurrency tracker, updated in place.
 * @returns Resolves once the article is rendered or skipped.
 * @example
 * ```ts
 * await renderArticleOg(article, { renderPng, input, hash, cache, outDir }, tally);
 * ```
 */
async function renderArticleOg(
  article: Article,
  deps: {
    renderPng: OgPngRenderer;
    input: RichOgInput;
    hash: string;
    cache: Map<string, string>;
    outDir: string;
  },
  tally: RenderTally
): Promise<void> {
  // Cache hit — an unchanged article is counted as skipped and never rasterized.
  const key = article.computed.contentId;
  if (deps.cache.get(key) === deps.hash) {
    tally.skipped += 1;
    return;
  }

  // Bracket the rasterization so the pool's peak concurrency is observed even on throw.
  tally.active += 1;
  tally.peakConcurrency = Math.max(tally.peakConcurrency, tally.active);
  try {
    const png = await deps.renderPng(deps.input);
    await mkdir(deps.outDir, { recursive: true });
    // Name the PNG by the URL-clean `slug`, NOT `loadAll`'s reassigned `${locale}:${index}:${slug}`
    // contentId. Route loaders see `load()`'s contentId === slug (and `computed.slug`), so the file
    // must be `/og/{slug}.png` for a consumer's `og:image` to resolve. The hash CACHE key stays
    // `contentId` (stable + unique across locales).
    await writeFile(path.join(deps.outDir, `${article.computed.slug}.png`), png);
    deps.cache.set(key, deps.hash);
    tally.rendered += 1;
  } finally {
    tally.active -= 1;
  }
}

/**
 * Renders OG images for published articles with a `p-limit(4)` concurrency pool.
 * Computes {@link ogHash} (full {@link RichOgInput} + template + fonts) per article
 * and skips regeneration when the hash matches `state.ogImageHashCache`; writes the
 * cache back to `<outDir>/.cache/og-images.json`. The configured `ogImage.render`
 * hook (when present) builds each card; otherwise the built-in card is used. Fonts
 * are loaded ONCE for the whole pass. No-op when `config.ogImage` is false.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @param options - Optional dependency-injection seam (PNG rasterizer).
 * @returns The render/skip counts + peak concurrency, or `null` when disabled.
 * @example
 * ```ts
 * const result = await generateOgImages(ctx);
 * ```
 */
export async function generateOgImages(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log">,
  options: OgImagesOptions = {}
): Promise<OgImagesResult | null> {
  // OG images are opt-in — a disabled build skips the phase entirely.
  const og = ctx.config.ogImage;
  if (!og) {
    ctx.log.debug("build:og-images", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }

  // Resolve the render settings + load fonts ONCE for the whole pass (outside the per-image loop).
  const config: OgImageConfig = og;
  const size = config.size ?? DEFAULT_SIZE;
  const template = config.template ?? "default";
  const fontsHash = fontsKey(config.fonts);
  const fonts = options.renderPng ? [] : await loadFonts(config);
  const renderHook = config.render ? { render: config.render } : {};
  const renderPng = options.renderPng ?? makeDefaultRenderer({ fonts, ...renderHook });

  // Gather the inputs: site name, published default-locale articles, and the warmed hash cache.
  const siteName = resolveSiteName(ctx);
  const defaultLocale = ctx.require(i18nPlugin).defaultLocale();
  const articles = selectArticles(readCachedContent(ctx), defaultLocale);
  const cache = ctx.state.ogImageHashCache;
  await loadDiskCache(ctx.config.outDir, cache);

  // Render every article through the bounded pool, accumulating counts + peak concurrency.
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(OG_CONCURRENCY);
  const outDir = path.join(ctx.config.outDir, "og");
  const tally: RenderTally = { rendered: 0, skipped: 0, active: 0, peakConcurrency: 0 };
  await Promise.all(
    articles.map(article =>
      limit(() => {
        const input = buildInput(article, size, siteName);
        const hash = ogHash(input, template, fontsHash);
        return renderArticleOg(article, { renderPng, input, hash, cache, outDir }, tally);
      })
    )
  );

  // Persist the updated hash cache so the next build can skip unchanged articles.
  await persistDiskCache(ctx.config.outDir, cache);
  ctx.log.debug("build:og-images", { rendered: tally.rendered, skipped: tally.skipped });
  return {
    rendered: tally.rendered,
    skipped: tally.skipped,
    peakConcurrency: tally.peakConcurrency
  };
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
