/**
 * @file build phase 2 — content. Delegates entirely to the content plugin via
 * `ctx.require(contentPlugin).loadAll()`; caches docs for downstream phases.
 * Does NOT parse Markdown / run Shiki / interpret frontmatter (god-plugin guard).
 */
import { contentPlugin } from "../../content";
import type { Article } from "../../content/types";
import type { PhaseContext } from "../types";

/** `state.buildCache` key under which the locale-keyed content map is stored. */
export const CONTENT_CACHE_KEY = "content";

/**
 * Pulls all content via `ctx.require(contentPlugin).loadAll()` and caches the
 * returned locale-keyed article map in `state.buildCache` for the
 * pages/feeds/og-images phases. Performs NO Markdown parsing itself — the
 * content plugin owns rendering (god-plugin invariant).
 *
 * @param ctx - Plugin context (provides `require`, `state`, `log`).
 * @returns The locale-keyed article map returned by the content plugin.
 * @example
 * ```ts
 * const byLocale = await loadContent(ctx);
 * ```
 */
export async function loadContent(
  ctx: Pick<PhaseContext, "require" | "state" | "log">
): Promise<Map<string, Article[]>> {
  const byLocale = await ctx.require(contentPlugin).loadAll();
  ctx.state.buildCache.set(CONTENT_CACHE_KEY, byLocale);
  ctx.log.debug("build:content", { locales: byLocale.size });
  return byLocale;
}

/**
 * Reads the cached content map populated by {@link loadContent}.
 *
 * @param ctx - Plugin context (provides `state`).
 * @returns The cached locale-keyed article map, or an empty map when absent.
 * @example
 * ```ts
 * const byLocale = readCachedContent(ctx);
 * ```
 */
export function readCachedContent(ctx: Pick<PhaseContext, "state">): Map<string, Article[]> {
  const cached = ctx.state.buildCache.get(CONTENT_CACHE_KEY);
  return cached instanceof Map ? (cached as Map<string, Article[]>) : new Map();
}
