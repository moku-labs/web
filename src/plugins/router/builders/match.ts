/**
 * @file router plugin — runtime matching domain.
 *
 * Pure functions that turn compiled patterns into a pathname matcher: build the
 * lang-aware/bare `URLPattern` pair, the `matchFn` (withLang first, bare fallback
 * injecting `defaultLocale`), and extract/strip params. No `ctx` here.
 */

import type { PathMatcher } from "../iso-match";
import { extractGroups } from "../iso-match";
import type { CompiledRoute, RouteDefinition } from "../types";

// The router's runtime param extractor IS the isomorphic `extractGroups`, re-exported
// under the matching-domain name so the server table (here) and the client matcher
// (iso-match) share ONE implementation and can never drift.
export { extractGroups as extractParams } from "../iso-match";

/**
 * Build a pathname matcher for a single route: tries the `withLang` matcher,
 * then the `bare` matcher injecting `defaultLocale` on miss.
 *
 * @param matchers - The pre-built `withLang` and `bare` matcher pair.
 * @param matchers.withLang - The locale-aware matcher variant.
 * @param matchers.bare - The bare matcher variant (no leading locale segment).
 * @param defaultLocale - Locale injected when the bare fallback matches.
 * @returns A function resolving a pathname into params, or `null` on no match.
 * @example
 * ```ts
 * const matchFn = createMatchFunction(matchers, "en");
 * ```
 */
export function createMatchFunction(
  matchers: { readonly withLang: PathMatcher; readonly bare: PathMatcher },
  defaultLocale: string
): (pathname: string) => Record<string, string> | null {
  return (pathname: string): Record<string, string> | null => {
    const withLang = matchers.withLang.exec({ pathname });
    if (withLang) return extractGroups(withLang.pathname.groups);
    const bare = matchers.bare.exec({ pathname });
    if (bare) {
      const params = extractGroups(bare.pathname.groups);
      params.lang = defaultLocale;
      return params;
    }
    // eslint-disable-next-line unicorn/no-null -- matchFn contract returns `null` on miss (URLPattern + RouterApi shape)
    return null;
  };
}

/**
 * Scan the specificity-sorted compiled routes and return the first match.
 *
 * @param compiled - The compiled routes, sorted by specificity (most specific first).
 * @param pathname - The pathname to match.
 * @returns `{ params, route }` for the first matching route, or `null`.
 * @example
 * ```ts
 * matchRoute(compiled, "/en/hello/");
 * ```
 */
export function matchRoute(
  compiled: readonly CompiledRoute[],
  pathname: string
): { params: Record<string, string>; route: RouteDefinition } | null {
  for (const entry of compiled) {
    const params = entry.matchFn(pathname);
    if (params) return { params, route: entry.definition };
  }
  // eslint-disable-next-line unicorn/no-null -- `match` contract returns `null` when no route matches
  return null;
}
