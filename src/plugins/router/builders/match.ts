/**
 * @file router plugin — runtime matching domain skeleton.
 *
 * Pure functions that turn compiled patterns into a pathname matcher: build the
 * lang-aware/bare `URLPattern` pair, the `matchFn` (withLang first, bare fallback
 * injecting `defaultLocale`), and extract/strip params. No `ctx` here.
 */
import type { CompiledRoute, RouteDefinition } from "../types";

/**
 * Build a pathname matcher for a single route: tries the `withLang` URLPattern,
 * then the `bare` pattern injecting `defaultLocale` on miss.
 *
 * @param _matchers - The pre-built `withLang` and `bare` URLPattern pair.
 * @param _matchers.withLang - The locale-aware URLPattern variant.
 * @param _matchers.bare - The bare URLPattern variant (no leading locale segment).
 * @param _defaultLocale - Locale injected when the bare fallback matches.
 * @example
 * ```ts
 * const matchFn = createMatchFunction(matchers, "en");
 * ```
 */
export function createMatchFunction(
  _matchers: { readonly withLang: URLPattern; readonly bare: URLPattern },
  _defaultLocale: string
): (pathname: string) => Record<string, string> | null {
  throw new Error("not implemented");
}

/**
 * Extract named groups from a `URLPattern` match result, stripping numeric/regex
 * group keys so only declared param names remain.
 *
 * @param _groups - The `URLPatternResult.pathname.groups` object.
 * @example
 * ```ts
 * extractParams({ slug: "hello", "0": "x" }); // { slug: "hello" }
 * ```
 */
export function extractParams(_groups: Record<string, string | undefined>): Record<string, string> {
  throw new Error("not implemented");
}

/**
 * Scan the specificity-sorted compiled routes and return the first match.
 *
 * @param _compiled - The compiled routes, sorted by specificity.
 * @param _pathname - The pathname to match.
 * @example
 * ```ts
 * matchRoute(compiled, "/en/hello/");
 * ```
 */
export function matchRoute(
  _compiled: readonly CompiledRoute[],
  _pathname: string
): { params: Record<string, string>; route: RouteDefinition } | null {
  throw new Error("not implemented");
}
