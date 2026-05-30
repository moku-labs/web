/**
 * @file build phase 4 — feeds. Generates RSS/Atom/JSON from cached content plus
 * site/i18n metadata (per-item GUID = canonical article URL). Gated by config.feeds.
 */

/**
 * Generates RSS, Atom, and JSON feeds from the cached content set and the
 * `site`/`i18n` metadata pulled via `ctx.require`. Each item's GUID is its
 * canonical article URL. No-op when `config.feeds` is false.
 *
 * @param _ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @example
 * ```ts
 * await generateFeeds(ctx);
 * ```
 */
export function generateFeeds(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
