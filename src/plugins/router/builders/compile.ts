/**
 * @file router plugin — compilation + validation domain skeleton.
 *
 * Pure functions invoked from `onInit`: validate the route map, then compile each
 * route into URLPattern matchers + URL/file builders, count dynamic segments,
 * sort by specificity, and assemble the immutable `MatcherTable`. Receives DATA
 * only (`CompileInput`) — never the plugin ctx.
 */
import type { CompileInput, MatcherTable, RouterConfig } from "../types";

/**
 * Validate the route map (fail-fast in `onInit`). Throws with the `[web]` prefix
 * naming the offending route/pattern on any failure.
 *
 * @param _routes - The route map from config.
 * @throws {Error} If routes are empty, a pattern is malformed, or names collide.
 * @example
 * ```ts
 * validateRoutes({ home: routeDef });
 * ```
 */
export function validateRoutes(_routes: RouterConfig["routes"]): void {
  throw new Error("not implemented");
}

/**
 * Convert a user pattern to a `URLPattern` source string, in a `withLang` or
 * `bare` variant (the latter strips the optional `{lang:?}` segment).
 *
 * @param _pattern - The user pattern, e.g. `/{lang:?}/{slug}/`.
 * @param _variant - `"withLang"` (locale regex injected) or `"bare"`.
 * @param _langRegex - Locale alternation regex, e.g. `(en|uk)`.
 * @example
 * ```ts
 * patternToUrlPattern("/{slug}/", "bare", "(en|uk)");
 * ```
 */
export function patternToUrlPattern(
  _pattern: string,
  _variant: "withLang" | "bare",
  _langRegex: string
): string {
  throw new Error("not implemented");
}

/**
 * Build a URL from a pattern and params (substitutes `{param}` / `{param:?}`).
 *
 * @param _pattern - The route pattern.
 * @param _params - Param values to substitute.
 * @param _baseUrl - Site base URL for absolute links.
 * @example
 * ```ts
 * buildUrl("/{slug}/", { slug: "hello" }, "https://blog.dev");
 * ```
 */
export function buildUrl(
  _pattern: string,
  _params: Record<string, string>,
  _baseUrl: string
): string {
  throw new Error("not implemented");
}

/**
 * Build an output file path from a pattern and params.
 *
 * @param _pattern - The route pattern.
 * @param _params - Param values to substitute.
 * @example
 * ```ts
 * buildFilePath("/{slug}/", { slug: "hello" });
 * ```
 */
export function buildFilePath(_pattern: string, _params: Record<string, string>): string {
  throw new Error("not implemented");
}

/**
 * Count dynamic segments in a pattern (lower = more specific). Used for sorting.
 *
 * @param _pattern - The route pattern.
 * @example
 * ```ts
 * countDynamicSegments("/{lang:?}/{slug}/"); // 2
 * ```
 */
export function countDynamicSegments(_pattern: string): number {
  throw new Error("not implemented");
}

/**
 * Compile the route map into a specificity-sorted, immutable `MatcherTable`.
 * Builds both URLPattern variants per route, the `matchFn`, the `toUrl`/`toFile`
 * closures, and the `byName` index, then sorts ascending by dynamic-segment count.
 *
 * @param _input - Resolved DATA (routes, mode, baseUrl, locales, defaultLocale).
 * @example
 * ```ts
 * compileRoutes({ routes: {}, mode: "hybrid", baseUrl: "https://blog.dev", locales: ["en"], defaultLocale: "en" });
 * ```
 */
export function compileRoutes(_input: CompileInput): MatcherTable {
  throw new Error("not implemented");
}

/**
 * onInit orchestrator (data-only seam, keeps `index.ts` wiring-only). Validates
 * the route map then compiles the matcher table from resolved dependency data.
 *
 * @param config - Resolved router config (`routes` + `mode`).
 * @param baseUrl - Site base URL from `ctx.require(sitePlugin).url()`.
 * @param locales - Available locales from `ctx.require(i18nPlugin).locales()`.
 * @param defaultLocale - Default locale from `ctx.require(i18nPlugin).defaultLocale()`.
 * @returns The compiled, immutable matcher table for `ctx.state.table`.
 * @example
 * ```ts
 * ctx.state.table = buildRouterTable(ctx.config, site.url(), i18n.locales(), i18n.defaultLocale());
 * ```
 */
export function buildRouterTable(
  config: RouterConfig,
  baseUrl: string,
  locales: readonly string[],
  defaultLocale: string
): MatcherTable {
  validateRoutes(config.routes);
  return compileRoutes({
    routes: config.routes,
    mode: config.mode ?? "hybrid",
    baseUrl,
    locales,
    defaultLocale
  });
}
