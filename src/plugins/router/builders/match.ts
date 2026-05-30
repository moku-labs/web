/**
 * @file router plugin — runtime matching domain.
 *
 * Pure functions that turn compiled patterns into a pathname matcher: build the
 * lang-aware/bare `URLPattern` pair, the `matchFn` (withLang first, bare fallback
 * injecting `defaultLocale`), and extract/strip params. No `ctx` here.
 */
import type { CompiledRoute, RouteDefinition } from "../types";

/**
 * Extract named groups from a `URLPattern` match result, stripping numeric/regex
 * group keys so only declared param names remain.
 *
 * @param groups - The `URLPatternResult.pathname.groups` object.
 * @returns A clean record of named params (numeric keys + undefined values dropped).
 * @example
 * ```ts
 * extractParams({ slug: "hello", "0": "x" }); // { slug: "hello" }
 * ```
 */
export function extractParams(groups: Record<string, string | undefined>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (/^\d+$/.test(key)) continue;
    if (value !== undefined) params[key] = value;
  }
  return params;
}

/**
 * Build a pathname matcher for a single route: tries the `withLang` URLPattern,
 * then the `bare` pattern injecting `defaultLocale` on miss.
 *
 * @param matchers - The pre-built `withLang` and `bare` URLPattern pair.
 * @param matchers.withLang - The locale-aware URLPattern variant.
 * @param matchers.bare - The bare URLPattern variant (no leading locale segment).
 * @param defaultLocale - Locale injected when the bare fallback matches.
 * @returns A function resolving a pathname into params, or `null` on no match.
 * @example
 * ```ts
 * const matchFn = createMatchFunction(matchers, "en");
 * ```
 */
export function createMatchFunction(
  matchers: { readonly withLang: URLPattern; readonly bare: URLPattern },
  defaultLocale: string
): (pathname: string) => Record<string, string> | null {
  return (pathname: string): Record<string, string> | null => {
    const withLang = matchers.withLang.exec({ pathname });
    if (withLang) return extractParams(withLang.pathname.groups);
    const bare = matchers.bare.exec({ pathname });
    if (bare) {
      const params = extractParams(bare.pathname.groups);
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
