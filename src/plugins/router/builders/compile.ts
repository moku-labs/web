/**
 * @file router plugin — compilation + validation domain.
 *
 * Pure functions invoked from `onInit`: validate the route map, then compile each
 * route into URLPattern matchers + URL/file builders, count dynamic segments,
 * sort by specificity, and assemble the immutable `MatcherTable`. Receives DATA
 * only (`CompileInput`) — never the plugin ctx.
 */

import type { PathMatcher } from "../iso-match";
import {
  bySpecificity,
  createPathMatcher,
  dynamicSegmentCount,
  parsePlaceholder
} from "../iso-match";
import type {
  CompiledRoute,
  CompileInput,
  MatcherTable,
  RouteDefinition,
  RouteMap
} from "../types";
import { createMatchFunction } from "./match";

/** Shared `[web]` error prefix for router validation failures. */
const ERROR_PREFIX = "[web] router";

/** Maximum number of optional `{lang:?}` segments a single pattern may declare. */
const MAX_LANG_SEGMENTS = 1;

/**
 * Whether a pattern is rooted — every route pattern must be absolute (start
 * with `/`) so it composes cleanly with the locale prefix and base URL.
 *
 * @param pattern - The user pattern to check.
 * @returns `true` when the pattern starts with `/`.
 * @example
 * ```ts
 * isPatternRooted("/{slug}/"); // true
 * ```
 */
function isPatternRooted(pattern: string): boolean {
  return pattern.startsWith("/");
}

/**
 * Whether a pattern's `{` and `}` braces are balanced — every placeholder must
 * be closed so segment parsing cannot drift.
 *
 * @param pattern - The user pattern to check.
 * @returns `true` when open and close brace counts are equal.
 * @example
 * ```ts
 * hasBalancedBraces("/{slug}/"); // true
 * ```
 */
function hasBalancedBraces(pattern: string): boolean {
  const open = (pattern.match(/\{/g) ?? []).length;
  const close = (pattern.match(/\}/g) ?? []).length;
  return open === close;
}

/**
 * Whether a pattern declares at most one optional `{lang:?}` segment — the
 * locale prefix is single-slot, so a second occurrence is ambiguous.
 *
 * @param pattern - The user pattern to check.
 * @returns `true` when the pattern has zero or one `{lang:?}` segments.
 * @example
 * ```ts
 * hasValidLangCount("/{lang:?}/{slug}/"); // true
 * ```
 */
function hasValidLangCount(pattern: string): boolean {
  return (pattern.match(/\{lang:\?\}/g) ?? []).length <= MAX_LANG_SEGMENTS;
}

/**
 * Assert a single route's pattern is well-formed, throwing the `[web]`-prefixed
 * error for the first failure: not rooted at `/`, unbalanced `{…}` braces, or
 * more than one `{lang:?}` segment. Extracted from {@link validateRoutes} so the
 * loop body stays flat.
 *
 * @param name - The route name key, surfaced in any error message.
 * @param pattern - The route's user pattern to validate.
 * @throws {Error} When the pattern is malformed.
 * @example
 * ```ts
 * assertRouteValid("home", "/{slug}/");
 * ```
 */
function assertRouteValid(name: string, pattern: string): void {
  // Patterns must be absolute so they compose with locale prefix + base URL.
  if (!isPatternRooted(pattern)) {
    throw new Error(
      `${ERROR_PREFIX}: route "${name}" pattern must start with "/" (got "${pattern}").`
    );
  }

  // Every placeholder must be closed so segment parsing cannot drift.
  if (!hasBalancedBraces(pattern)) {
    throw new Error(
      `${ERROR_PREFIX}: route "${name}" pattern has unbalanced braces ("${pattern}").`
    );
  }

  // The locale prefix is single-slot — a second `{lang:?}` is ambiguous.
  if (!hasValidLangCount(pattern)) {
    throw new Error(
      `${ERROR_PREFIX}: route "${name}" pattern has more than one {lang:?} segment ("${pattern}").`
    );
  }
}

/**
 * Validate the route map (fail-fast in `onInit`). Throws with the `[web]` prefix
 * naming the offending route/pattern on any failure: empty map, a pattern not
 * starting with `/`, unbalanced `{…}` braces, or more than one `{lang:?}` segment.
 *
 * @param routes - The route map registered via `pluginConfigs.router.routes`.
 * @throws {Error} If routes are empty or a pattern is malformed.
 * @example
 * ```ts
 * validateRoutes({ home: route("/") });
 * ```
 */
export function validateRoutes(routes: RouteMap): void {
  // A map with no routes is unusable — fail before per-route checks.
  const names = Object.keys(routes);
  if (names.length === 0) {
    throw new Error(
      `${ERROR_PREFIX}: route map is empty.\n  Register at least one route via pluginConfigs.router.routes.`
    );
  }

  // Reject the first malformed pattern, naming the offending route.
  for (const name of names) {
    const pattern = routes[name]?.pattern ?? "";
    assertRouteValid(name, pattern);
  }
}

/**
 * Convert a user pattern to a `URLPattern` source string, in a `withLang` or
 * `bare` variant (the latter strips the optional `{lang:?}` segment). Walks the
 * pattern one `/`-segment at a time (no backtracking regex).
 *
 * @param pattern - The user pattern, e.g. `/{lang:?}/{slug}/`.
 * @param variant - `"withLang"` (locale regex injected) or `"bare"`.
 * @param langRegex - Locale alternation regex, e.g. `(en|uk)`.
 * @returns A URLPattern-compatible pathname string.
 * @example
 * ```ts
 * patternToUrlPattern("/{slug}/", "bare", "(en|uk)");
 * ```
 */
export function patternToUrlPattern(
  pattern: string,
  variant: "withLang" | "bare",
  langRegex: string
): string {
  const out: string[] = [];
  for (const segment of pattern.split("/")) {
    const placeholder = parsePlaceholder(segment);

    // Static segment — copy it through verbatim.
    if (!placeholder) {
      out.push(segment);
      continue;
    }

    // Optional `{lang:?}` — keep it (with the locale regex) only in the withLang variant.
    if (placeholder.name === "lang" && placeholder.optional) {
      if (variant === "withLang") out.push(`:lang${langRegex}`);
      continue;
    }

    // Regular dynamic param — emit as a named URLPattern group.
    out.push(`:${placeholder.name}`);
  }
  return out.join("/");
}

/**
 * Build a URL from a pattern and params (substitutes `{param}` / `{param:?}`).
 * Walks segment-by-segment (no backtracking regex). An optional placeholder whose
 * param is absent has its segment skipped entirely (no empty segment), so a missing
 * `{lang:?}` collapses cleanly instead of leaving a double slash.
 *
 * @param pattern - The route pattern.
 * @param params - Param values to substitute.
 * @returns The resolved relative URL string.
 * @example
 * ```ts
 * buildUrl("/{slug}/", { slug: "hello" }); // "/hello/"
 * ```
 */
export function buildUrl(pattern: string, params: Record<string, string>): string {
  const out: string[] = [];
  for (const segment of pattern.split("/")) {
    const placeholder = parsePlaceholder(segment);
    if (!placeholder) {
      out.push(segment);
      continue;
    }
    const value = params[placeholder.name] ?? "";
    // Skip an absent optional segment so it collapses (no double slash).
    if (placeholder.optional && value === "") continue;
    out.push(value);
  }
  return out.join("/");
}

/**
 * Build an output file path from a pattern and params (always `…/index.html`).
 *
 * @param pattern - The route pattern.
 * @param params - Param values to substitute.
 * @returns The output file path, e.g. `hello/index.html`.
 * @example
 * ```ts
 * buildFilePath("/{slug}/", { slug: "hello" });
 * ```
 */
export function buildFilePath(pattern: string, params: Record<string, string>): string {
  const url = buildUrl(pattern, params);
  const cleanPath = url.replace(/^\//, "").replace(/\/$/, "");
  return cleanPath === "" ? "index.html" : `${cleanPath}/index.html`;
}

/**
 * Build both URLPattern matchers for a route — the `withLang` variant (locale
 * prefix injected) and the `bare` variant (optional `{lang:?}` stripped) — from
 * the user pattern and the active locale alternation.
 *
 * @param pattern - The user pattern, e.g. `/{lang:?}/{slug}/`.
 * @param locales - Active locale codes, joined into the alternation regex.
 * @returns The frozen `{ withLang, bare }` matcher pair.
 * @example
 * ```ts
 * const matchers = buildMatchers("/{lang:?}/{slug}/", ["en", "uk"]);
 * ```
 */
function buildMatchers(
  pattern: string,
  locales: readonly string[]
): { readonly withLang: PathMatcher; readonly bare: PathMatcher } {
  const langRegex = `(${locales.join("|")})`;
  return {
    withLang: createPathMatcher(patternToUrlPattern(pattern, "withLang", langRegex)),
    bare: createPathMatcher(patternToUrlPattern(pattern, "bare", langRegex))
  } as const;
}

/**
 * Build the `toUrl` closure for a route — resolves the pattern against params
 * into a relative URL. Captured per-route so callers need not re-supply the
 * pattern.
 *
 * @param pattern - The route pattern bound into the closure.
 * @returns A function mapping params to the resolved relative URL.
 * @example
 * ```ts
 * const toUrl = createToUrlFn("/{slug}/");
 * toUrl({ slug: "x" }); // "/x/"
 * ```
 */
function createToUrlFunction(pattern: string): (params: Record<string, string>) => string {
  return (params: Record<string, string>): string => buildUrl(pattern, params);
}

/**
 * Build the `toFile` closure for a route — resolves the output file path from
 * params. Honors a custom `.toFile()` override (captured in `_handlers.toFile`)
 * when present, falling back to the pattern-derived `…/index.html` path.
 *
 * @param pattern - The route pattern bound into the closure.
 * @param definition - The route definition carrying any `toFile` override.
 * @returns A function mapping params to the output file path.
 * @example
 * ```ts
 * const toFile = createToFileFn("/{slug}/", definition);
 * toFile({ slug: "x" }); // "x/index.html"
 * ```
 */
function createToFileFunction(
  pattern: string,
  definition: RouteDefinition
): (params: Record<string, string>) => string {
  return (params: Record<string, string>): string =>
    definition._handlers.toFile?.(params) ?? buildFilePath(pattern, params);
}

/**
 * Compile a single route definition into its `CompiledRoute` entry.
 *
 * @param name - The route name key.
 * @param definition - The (opaque) route definition carrier.
 * @param input - Resolved compile data (locales, defaultLocale, baseUrl, …).
 * @returns The compiled route entry with matchers + URL utilities.
 * @example
 * ```ts
 * compileRoute("home", routeDef, input);
 * ```
 */
function compileRoute(
  name: string,
  definition: RouteDefinition,
  input: CompileInput
): CompiledRoute {
  // Build the URLPattern matchers (both locale variants) from the user pattern.
  const { pattern } = definition;
  const matchers = buildMatchers(pattern, input.locales);

  // Capture the per-route URL/file builders that close over the pattern.
  const toUrl = createToUrlFunction(pattern);
  const toFile = createToFileFunction(pattern, definition);

  // Assemble the compiled entry: matchers, match fn, builders, and metadata.
  return {
    name,
    pattern,
    dynamicSegmentCount: dynamicSegmentCount(pattern),
    matchers,
    matchFn: createMatchFunction(matchers, input.defaultLocale),
    toUrl,
    toFile,
    definition,
    meta: { ...definition._meta }
  };
}

/**
 * Compile the route map into a specificity-sorted, immutable `MatcherTable`.
 * Builds both URLPattern variants per route, the `matchFn`, the `toUrl`/`toFile`
 * closures, and the `byName` index, then sorts ascending by dynamic-segment count
 * (stable, preserving declaration order among equal-specificity routes).
 *
 * @param input - Resolved DATA (routes, mode, baseUrl, locales, defaultLocale).
 * @returns The compiled, immutable matcher table.
 * @example
 * ```ts
 * compileRoutes({ routes: { home: route("/") }, mode: "hybrid", baseUrl: "https://blog.dev", locales: ["en"], defaultLocale: "en" });
 * ```
 */
export function compileRoutes(input: CompileInput): MatcherTable {
  const byName = new Map<string, CompiledRoute>();
  const declarationOrder: CompiledRoute[] = [];
  for (const [name, definition] of Object.entries(input.routes)) {
    const entry = compileRoute(name, definition, input);
    declarationOrder.push(entry);
    byName.set(name, entry);
  }
  // `toSorted` is a stable sort; `bySpecificity` returns 0 on equal specificity,
  // so equal-specificity routes preserve declaration order (the SAME ordering the
  // client reproduces from `clientManifest()` — single source of truth).
  const compiled = declarationOrder.toSorted(bySpecificity);
  return { compiled, byName };
}
