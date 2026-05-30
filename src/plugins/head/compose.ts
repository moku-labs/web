/**
 * @file head plugin — shared pure composition module (reused by `spa` in Increment B)
 *
 * The pure composition logic — `(HeadConfig, defaults, locales, urls) → HeadElement[]` —
 * lives here so `spa` can import it without making `head` depend on `spa`. Dependency
 * direction is strictly `spa → head`; `head` must never import `spa`.
 */
import type { HeadDefaults, HeadElement, ResolvedRoute } from "./types";

/**
 * Inputs required to compose a route's head element set, gathered by `render` from the
 * route, page data, normalized defaults, and the resolved `site`/`i18n`/`router` APIs.
 *
 * @example
 * ```ts
 * const input: ComposeInput = { route, data, defaults, site, i18n, router };
 * ```
 */
export type ComposeInput = {
  /** The resolved route descriptor (incl. its `.head()` HeadConfig). */
  route: ResolvedRoute;
  /** The page data object passed to the route's loader/render. */
  data: unknown;
  /** The normalized head defaults snapshot (populated after `onInit`). */
  defaults: HeadDefaults;
  /** The resolved `site` plugin API. */
  site: unknown;
  /** The resolved `i18n` plugin API. */
  i18n: unknown;
  /** The resolved `router` plugin API. */
  router: unknown;
};

/**
 * Compose the ordered, de-duplicated `HeadElement[]` for a route from site defaults,
 * i18n hreflang alternates, and the route's head config.
 *
 * @param _input - The gathered composition inputs.
 * @example composeHead({ route, data, defaults, site, i18n, router })
 */
export function composeHead(_input: ComposeInput): HeadElement[] {
  throw new Error("not implemented");
}

/**
 * Serialize a `HeadElement[]` to `<head>` inner HTML. All attribute values are
 * HTML-attribute-escaped; JSON-LD payloads are already unicode-escaped by `jsonLd`.
 *
 * @param _elements - The composed head elements.
 * @example serializeHead(composeHead(input))
 */
export function serializeHead(_elements: HeadElement[]): string {
  throw new Error("not implemented");
}
