/**
 * @file build phase 2 — content. Delegates entirely to the content plugin via
 * `ctx.require(contentPlugin).loadAll()`; caches docs for downstream phases.
 * Does NOT parse Markdown / run Shiki / interpret frontmatter (god-plugin guard).
 */

/**
 * Pulls all content via `ctx.require(contentPlugin).loadAll()` and caches the
 * returned docs in `state.buildCache` for the pages/feeds/og-images phases.
 *
 * @param _ctx - Plugin context (provides `require`, `state`, `log`).
 * @example
 * ```ts
 * await loadContent(ctx);
 * ```
 */
export function loadContent(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
