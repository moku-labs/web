/**
 * @file router plugin — pure isomorphic route matcher (no `node:*`, no DOM).
 *
 * The single source of the specificity ordering + matcher compilation shared by
 * the server route table (`builders/match.ts`) and the browser SPA JSON nav.
 * Pattern strings are JSON-serializable; matchers are reconstructed lazily on the
 * client from those strings. Implementation lands in client-data wave 1.
 */

/** Shared not-implemented marker (SonarJS: avoid a repeated string literal). */
const NOT_IMPLEMENTED = "router/iso-match: not implemented (client-data wave 1)";

/**
 * Counts the dynamic (`{param}` / `:param`) segments in a route pattern — fewer
 * dynamic segments rank as more specific.
 *
 * @param _pattern - The route pattern string.
 * @throws {Error} Always — implemented in client-data wave 1.
 * @example
 * ```ts
 * dynamicSegmentCount("/blog/{slug}/"); // 1
 * ```
 */
export function dynamicSegmentCount(_pattern: string): number {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Comparator that orders two routes most-specific-first (stable across server
 * and client).
 *
 * @param _a - First route (carries its `pattern` string).
 * @param _a.pattern - First route's pattern string.
 * @param _b - Second route (carries its `pattern` string).
 * @param _b.pattern - Second route's pattern string.
 * @throws {Error} Always — implemented in client-data wave 1.
 * @example
 * ```ts
 * routes.sort(bySpecificity);
 * ```
 */
export function bySpecificity(_a: { pattern: string }, _b: { pattern: string }): number {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Compiles a pattern string into a pure matcher: given a pathname it returns the
 * extracted params, or `null` on no match. Reconstructed lazily on the client.
 *
 * @param _pattern - The route pattern string.
 * @throws {Error} Always — implemented in client-data wave 1.
 * @example
 * ```ts
 * const match = compileClientMatcher("/blog/{slug}/");
 * match("/blog/hello/"); // { slug: "hello" }
 * ```
 */
export function compileClientMatcher(
  _pattern: string
): (pathname: string) => Record<string, string> | null {
  throw new Error(NOT_IMPLEMENTED);
}
