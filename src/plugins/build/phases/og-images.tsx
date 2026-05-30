/**
 * @file build phase 4 — og-images. Renders one OG image per published article via
 * Satori → SVG → resvg → PNG, bounded by `p-limit(4)`, with a persisted
 * content-hash cache (`<outDir>/.cache/og-images.json`) skipping unchanged articles.
 * Gated by config.ogImage (object enables; false disables).
 */

/**
 * Renders OG images for published articles with a `p-limit(4)` concurrency pool.
 * Computes `sha256(title + template + size)` per article and skips regeneration
 * when the hash matches `state.ogImageHashCache`; writes the cache back to disk.
 * No-op when `config.ogImage` is false.
 *
 * @param _ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @example
 * ```ts
 * await generateOgImages(ctx);
 * ```
 */
export function generateOgImages(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
