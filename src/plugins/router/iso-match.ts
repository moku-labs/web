/**
 * @file router plugin — pure isomorphic route matcher (no `node:*`, no DOM).
 *
 * The single source of the specificity ordering + matcher compilation shared by
 * the server route table (`builders/match.ts` / `builders/compile.ts`) and the
 * browser SPA JSON nav. Pattern strings are JSON-serializable; matchers are
 * reconstructed lazily on the client from those strings. Matchers compile to a
 * native `RegExp` ({@link createPathMatcher}) rather than the `URLPattern` global,
 * so route resolution runs in every engine — Safari < 18.4 and Firefox < ~142 ship
 * no `URLPattern` and would otherwise throw on boot. This module imports nothing.
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

    // Static segment — copy it through verbatim.
    if (!placeholder) {
      out.push(segment);
      continue;
    }

    // Optional {lang:?} — emit URLPattern's optional group.
    if (placeholder.name === "lang" && placeholder.optional) {
      out.push(":lang?");
      continue;
    }

    // Regular dynamic param — emit as a named group.
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
 * A compiled, engine-agnostic path matcher: the same `.exec({ pathname })` shape the
 * router consumed from `URLPattern`, but backed by a native `RegExp` with named
 * groups. Dropping `URLPattern` keeps route matching alive in every browser engine —
 * Safari < 18.4 and Firefox < ~142 have no `URLPattern` global and would otherwise
 * throw `ReferenceError` the instant the router compiles its table on boot.
 */
export interface PathMatcher {
  /**
   * Match a pathname, mirroring `URLPattern.exec`: the named-group bag (under
   * `pathname.groups`) on a hit, or `null` on a miss.
   *
   * @param input - The match input carrying the `pathname` to test.
   * @param input.pathname - The URL pathname to match, e.g. `/en/hello/`.
   * @returns A `{ pathname: { groups } }` result on a match, or `null` on no match.
   */
  exec(input: {
    readonly pathname: string;
  }): { readonly pathname: { readonly groups: Record<string, string | undefined> } } | null;
}

/** Regex metacharacters escaped when a static path segment is inlined into a compiled pattern. */
const REGEX_METACHARS = /[.*+?^${}()|[\]\\]/g;

/** Matches a `:name` or `:name(regex)` URLPattern group occupying one whole segment. */
const NAMED_GROUP = /^:([A-Za-z_]\w*)(?:\((.+)\))?$/;

/**
 * Escape a static path segment so its literal text matches verbatim inside the
 * compiled `RegExp` (a segment like `c++` must not be read as regex syntax).
 *
 * @param text - The static segment text.
 * @returns The regex-escaped segment.
 * @example
 * ```ts
 * escapeStaticSegment("about"); // "about"
 * ```
 */
function escapeStaticSegment(text: string): string {
  return text.replaceAll(REGEX_METACHARS, String.raw`\$&`);
}

/**
 * Compile one URLPattern source segment (no surrounding slash) into a regex fragment
 * that captures a single path segment: `:name` → a named `[^/]+` group, `:name(re)` →
 * a named group constrained by `re`, and static text → its escaped literal.
 *
 * @param segment - One source segment, e.g. `:slug`, `:lang(en|uk)`, or `archive`.
 * @returns The regex fragment for that segment.
 * @example
 * ```ts
 * segmentToRegex(":lang(en|uk)"); // "(?<lang>en|uk)"
 * ```
 */
function segmentToRegex(segment: string): string {
  const named = NAMED_GROUP.exec(segment);
  if (named) {
    const [, name, constraint] = named;
    return `(?<${name}>${constraint ?? "[^/]+"})`;
  }
  return escapeStaticSegment(segment);
}

/**
 * Compile a URLPattern pathname source string into a {@link PathMatcher} backed by a
 * native `RegExp` — a drop-in replacement for `new URLPattern({ pathname })` over the
 * subset the router emits: `:name`, `:name(regex)`, the optional `:name?` segment
 * (whose leading `/` is absorbed, so `/:lang?` matches `/en` or nothing), static
 * segments, and a required trailing slash. Anchored full-match, like `URLPattern`.
 *
 * @param source - The URLPattern pathname source, e.g. `/:lang?/:slug/`.
 * @returns A matcher whose `.exec({ pathname })` yields named groups or `null`.
 * @example
 * ```ts
 * const m = createPathMatcher("/:lang?/:slug/");
 * m.exec({ pathname: "/en/hello/" }); // { pathname: { groups: { lang: "en", slug: "hello" } } }
 * ```
 */
export function createPathMatcher(source: string): PathMatcher {
  const segments = source.split("/");

  // Rebuild the source as an anchored regex, segment by segment. segments[0] is the
  // empty string before the leading slash; each later segment carries its own `/`.
  let pattern = "^";
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";

    // Empty final segment ⇒ the pattern ended with `/` ⇒ require a literal trailing slash.
    if (segment === "") {
      pattern += "/";
      continue;
    }

    // A `?` modifier makes the segment AND its leading slash optional (path-to-regexp
    // prefix semantics) — this is how `{lang:?}` matches both `/en/x/` and `/x/`.
    const optional = segment.endsWith("?");
    const fragment = segmentToRegex(optional ? segment.slice(0, -1) : segment);
    pattern += optional ? `(?:/${fragment})?` : `/${fragment}`;
  }
  pattern += "$";

  const regexp = new RegExp(pattern);
  return {
    /**
     * Run the compiled regex over a pathname (the {@link PathMatcher.exec} contract).
     *
     * @param input - The match input carrying the `pathname` to test.
     * @param input.pathname - The URL pathname to match, e.g. `/en/hello/`.
     * @returns A `{ pathname: { groups } }` result on a match, or `null` on no match.
     * @example
     * ```ts
     * matcher.exec({ pathname: "/en/hello/" });
     * ```
     */
    exec(input: { readonly pathname: string }) {
      const result = regexp.exec(input.pathname);
      // eslint-disable-next-line unicorn/no-null -- matcher contract returns `null` on miss
      if (!result) return null;
      return { pathname: { groups: result.groups ?? {} } };
    }
  };
}

/**
 * Compiles a pattern string into a pure matcher: given a pathname it returns the
 * extracted params, or `null` on no match. Uses a native-RegExp {@link PathMatcher};
 * the client recompiles matchers lazily (module-cached) from the strings shipped by
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
  const matcher = createPathMatcher(toUrlPatternSource(pattern));
  return (pathname: string): Record<string, string> | null => {
    const result = matcher.exec({ pathname });
    // eslint-disable-next-line unicorn/no-null -- matcher contract returns `null` on miss
    if (!result) return null;
    return extractGroups(result.pathname.groups);
  };
}
