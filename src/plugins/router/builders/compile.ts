/**
 * @file router plugin — compilation + validation domain.
 *
 * Pure functions invoked from `onInit`: validate the route map, then compile each
 * route into URLPattern matchers + URL/file builders, count dynamic segments,
 * sort by specificity, and assemble the immutable `MatcherTable`. Receives DATA
 * only (`CompileInput`) — never the plugin ctx.
 */

import { bySpecificity, dynamicSegmentCount } from "../iso-match";
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

/**
 * Validate the route map (fail-fast in `onInit`). Throws with the `[web]` prefix
 * naming the offending route/pattern on any failure: empty map, a pattern not
 * starting with `/`, unbalanced `{…}` braces, or more than one `{lang:?}` segment.
 *
 * @param routes - The route map registered via `app.router.set(routes)`.
 * @throws {Error} If routes are empty or a pattern is malformed.
 * @example
 * ```ts
 * validateRoutes({ home: route("/") });
 * ```
 */
export function validateRoutes(routes: RouteMap): void {
  const names = Object.keys(routes);
  if (names.length === 0) {
    throw new Error(
      `${ERROR_PREFIX}: route map is empty.\n  Register at least one route via pluginConfigs.router.routes or app.router.set(routes).`
    );
  }
  for (const name of names) {
    const definition = routes[name];
    const pattern = definition?.pattern ?? "";
    if (!pattern.startsWith("/")) {
      throw new Error(
        `${ERROR_PREFIX}: route "${name}" pattern must start with "/" (got "${pattern}").`
      );
    }
    const open = (pattern.match(/\{/g) ?? []).length;
    const close = (pattern.match(/\}/g) ?? []).length;
    if (open !== close) {
      throw new Error(
        `${ERROR_PREFIX}: route "${name}" pattern has unbalanced braces ("${pattern}").`
      );
    }
    if ((pattern.match(/\{lang:\?\}/g) ?? []).length > 1) {
      throw new Error(
        `${ERROR_PREFIX}: route "${name}" pattern has more than one {lang:?} segment ("${pattern}").`
      );
    }
  }
}

/** A parsed `{name}` / `{name:?}` placeholder within one path segment. */
interface ParsedPlaceholder {
  /** The placeholder param name (e.g. `slug`). */
  readonly name: string;
  /** Whether the placeholder is optional (`{name:?}`). */
  readonly optional: boolean;
}

/**
 * Parse a single path segment into its placeholder, or `false` for a static
 * segment. Uses a plain loop over the brace delimiters (no backtracking regex).
 *
 * @param segment - One `/`-delimited segment, e.g. `{slug}` or `about`.
 * @returns The parsed placeholder, or `false` when the segment is static.
 * @example
 * ```ts
 * parsePlaceholder("{slug:?}"); // { name: "slug", optional: true }
 * ```
 */
function parsePlaceholder(segment: string): ParsedPlaceholder | false {
  if (!segment.startsWith("{") || !segment.endsWith("}")) return false;
  const inner = segment.slice(1, -1);
  if (inner.endsWith(":?")) return { name: inner.slice(0, -2), optional: true };
  return { name: inner, optional: false };
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
    if (!placeholder) {
      out.push(segment);
      continue;
    }
    if (placeholder.name === "lang" && placeholder.optional) {
      if (variant === "withLang") out.push(`:lang${langRegex}`);
      continue;
    }
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
  const { pattern } = definition;
  const langRegex = `(${input.locales.join("|")})`;
  const matchers = {
    withLang: new URLPattern({ pathname: patternToUrlPattern(pattern, "withLang", langRegex) }),
    bare: new URLPattern({ pathname: patternToUrlPattern(pattern, "bare", langRegex) })
  } as const;
  return {
    name,
    pattern,
    dynamicSegmentCount: dynamicSegmentCount(pattern),
    matchers,
    matchFn: createMatchFunction(matchers, input.defaultLocale),
    /**
     * Build a URL for this route from params.
     *
     * @param params - Param values to substitute.
     * @returns The resolved relative URL.
     * @example
     * ```ts
     * entry.toUrl({ slug: "x" });
     * ```
     */
    toUrl(params: Record<string, string>): string {
      return buildUrl(pattern, params);
    },
    /**
     * Build the output file path for this route from params. Honors a custom
     * `.toFile()` override (captured in `_handlers.toFile`) when present, falling
     * back to the pattern-derived `…/index.html` path otherwise.
     *
     * @param params - Param values to substitute.
     * @returns The output file path.
     * @example
     * ```ts
     * entry.toFile({ slug: "x" });
     * ```
     */
    toFile(params: Record<string, string>): string {
      return definition._handlers.toFile?.(params) ?? buildFilePath(pattern, params);
    },
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
