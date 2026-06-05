/**
 * @file router plugin — pure isomorphic route matcher (no `node:*`, no DOM).
 *
 * The single source of the specificity ordering + matcher compilation shared by
 * the server route table (`builders/match.ts` / `builders/compile.ts`) and the
 * browser SPA JSON nav. Pattern strings are JSON-serializable; matchers are
 * reconstructed lazily on the client from those strings. `URLPattern` is read as
 * a global (engines.node>=24), so this module imports nothing.
 */

/** A parsed `{name}` / `{name:?}` placeholder within one path segment. */
export interface ParsedPlaceholder {
  /** The placeholder param name (e.g. `slug`). */
  readonly name: string;
  /** Whether the placeholder is optional (`{name:?}`). */
  readonly optional: boolean;
}

/**
 * Parse a single path segment into its `{…}` placeholder, or `false` for a static
 * segment. Plain loop over the brace delimiters (no backtracking regex). Shared by
 * the build-time compiler and this isomorphic matcher so the two never diverge.
 *
 * @param segment - One `/`-delimited segment, e.g. `{slug}` or `about`.
 * @returns The parsed placeholder, or `false` when the segment is static.
 * @example
 * ```ts
 * parsePlaceholder("{slug:?}"); // { name: "slug", optional: true }
 * ```
 */
export function parsePlaceholder(segment: string): ParsedPlaceholder | false {
  if (!segment.startsWith("{") || !segment.endsWith("}")) return false;
  const inner = segment.slice(1, -1);
  if (inner.endsWith(":?")) return { name: inner.slice(0, -2), optional: true };
  return { name: inner, optional: false };
}

/**
 * Counts the dynamic (`{param}` / `{param:?}` / `:param`) segments in a route
 * pattern — fewer dynamic segments rank as more specific. The optional `{lang:?}`
 * segment is excluded so locale-prefixing does not affect priority (identical to
 * the build-time compiler's count, which sourced this logic).
 *
 * @param pattern - The route pattern string.
 * @returns The number of dynamic (non-lang) segments.
 * @example
 * ```ts
 * dynamicSegmentCount("/blog/{slug}/"); // 1
 * dynamicSegmentCount("/{lang:?}/{slug}/"); // 1
 * ```
 */
export function dynamicSegmentCount(pattern: string): number {
  let count = 0;
  for (const segment of pattern.split("/")) {
    const placeholder = parsePlaceholder(segment);
    const isBraceDynamic = placeholder && !(placeholder.name === "lang" && placeholder.optional);
    const isColonDynamic = !placeholder && segment.startsWith(":");
    if (isBraceDynamic || isColonDynamic) count += 1;
  }
  return count;
}

/**
 * Comparator that orders two routes most-specific-first (fewest dynamic segments
 * first). Equal specificity yields `0` so a stable sort preserves declaration
 * order — the exact ordering the compiled matcher table uses, guaranteeing
 * build-time and client-time route resolution can never diverge.
 *
 * @param a - First route (carries its `pattern` string).
 * @param a.pattern - First route's pattern string.
 * @param b - Second route (carries its `pattern` string).
 * @param b.pattern - Second route's pattern string.
 * @returns Negative if `a` is more specific, positive if `b` is, `0` on a tie.
 * @example
 * ```ts
 * routes.toSorted(bySpecificity);
 * ```
 */
export function bySpecificity(a: { pattern: string }, b: { pattern: string }): number {
  return dynamicSegmentCount(a.pattern) - dynamicSegmentCount(b.pattern);
}

/**
 * Convert a user pattern into a `URLPattern` pathname source: `{lang:?}` becomes
 * an optional `:lang?` group, every other `{name}` / `{name:?}` becomes `:name`,
 * and `:name` / static segments pass through unchanged.
 *
 * @param pattern - The user pattern, e.g. `/{lang:?}/{slug}/`.
 * @returns A URLPattern-compatible pathname string.
 * @example
 * ```ts
 * toUrlPatternSource("/{lang:?}/{slug}/"); // "/:lang?/:slug/"
 * ```
 */
function toUrlPatternSource(pattern: string): string {
  const out: string[] = [];
  for (const segment of pattern.split("/")) {
    const placeholder = parsePlaceholder(segment);
    if (!placeholder) {
      out.push(segment);
      continue;
    }
    if (placeholder.name === "lang" && placeholder.optional) {
      out.push(":lang?");
      continue;
    }
    out.push(`:${placeholder.name}`);
  }
  return out.join("/");
}

/**
 * Extract named groups from a `URLPattern` match result, dropping numeric/regex
 * group keys and `undefined` values so only declared, present params remain.
 *
 * @param groups - The `URLPatternResult.pathname.groups` object.
 * @returns A clean record of named params.
 * @example
 * ```ts
 * extractGroups({ slug: "hello", "0": "x" }); // { slug: "hello" }
 * ```
 */
export function extractGroups(groups: Record<string, string | undefined>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (/^\d+$/.test(key)) continue;
    if (value !== undefined) params[key] = value;
  }
  return params;
}

/**
 * Compiles a pattern string into a pure matcher: given a pathname it returns the
 * extracted params, or `null` on no match. Uses the global `URLPattern`; the
 * client recompiles matchers lazily (module-cached) from the strings shipped by
 * `clientManifest()`.
 *
 * @param pattern - The route pattern string.
 * @returns A matcher resolving a pathname into params, or `null` on no match.
 * @example
 * ```ts
 * const match = compileClientMatcher("/blog/{slug}/");
 * match("/blog/hello/"); // { slug: "hello" }
 * ```
 */
export function compileClientMatcher(
  pattern: string
): (pathname: string) => Record<string, string> | null {
  const matcher = new URLPattern({ pathname: toUrlPatternSource(pattern) });
  return (pathname: string): Record<string, string> | null => {
    const result = matcher.exec({ pathname });
    // eslint-disable-next-line unicorn/no-null -- matcher contract returns `null` on miss
    if (!result) return null;
    return extractGroups(result.pathname.groups);
  };
}
