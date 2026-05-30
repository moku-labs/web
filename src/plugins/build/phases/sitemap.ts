/**
 * @file build phase 4 — sitemap. Generates per-locale sitemaps + index + robots.txt
 * from the route manifest and `site.url` (hreflang cross-refs). Gated by config.sitemap.
 */

/**
 * Generates per-locale sitemaps, the sitemap index, and robots.txt from the route
 * manifest and `site.url` pulled via `ctx.require`, with hreflang cross-references.
 * No-op when `config.sitemap` is false.
 *
 * @param _ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @example
 * ```ts
 * await generateSitemap(ctx);
 * ```
 */
export function generateSitemap(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
