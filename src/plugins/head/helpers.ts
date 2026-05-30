/**
 * @file head plugin — SEO primitive helper bundle for plugin registration.
 *
 * Aggregates the pure SEO primitive helpers into a single record consumed by the
 * plugin's `helpers` slot in `index.ts` (kept here so `index.ts` stays wiring-only
 * and within its line budget). These same helpers are re-exported at the framework
 * index for direct consumer use.
 */
import {
  buildArticleHead,
  canonical,
  feedLink,
  hreflang,
  jsonLd,
  meta,
  og,
  twitter
} from "./primitives";

/**
 * The SEO primitive helper bundle registered on the `head` plugin.
 *
 * @example
 * ```ts
 * createPlugin("head", { helpers: headHelpers });
 * ```
 */
export const headHelpers = {
  meta,
  og,
  twitter,
  jsonLd,
  canonical,
  hreflang,
  feedLink,
  buildArticleHead
};
