/**
 * @file data plugin — the pure URL/file convention (no `node:*`, no DOM).
 *
 * ONE function maps a page path to its data suffix, so the browser fetch URL
 * (`baseUrl + suffix`) and the on-disk file (`outputDir + "/" + suffix`) are
 * derived from the same source and cannot drift. The data file mirrors the page
 * URL, mirroring how `build` writes `…/index.html` per page:
 *   `/`            → `index.json`
 *   `/en/hello/`   → `en/hello/index.json`
 *   `/en/hello`    → `en/hello/index.json`  (trailing slash normalized)
 *
 * Encoding split: the FETCH suffix ({@link dataSuffix}) keeps the page URL's
 * percent-encoding (the browser requests the encoded path), while the FILE path
 * ({@link relativeDataFile}) decodes it — static hosts and the dev/preview servers
 * decode the percent-encoded request path before resolving it against literal
 * file names, exactly like the page's own `…/index.html` (router `buildFilePath`).
 */

/**
 * Compute the data-file suffix for a page path: strip the leading slash, ensure a
 * single trailing slash, then append `index.json`. The root path collapses to
 * `index.json`.
 *
 * @param path - The page URL path (e.g. `/en/hello/`).
 * @returns The suffix shared by the fetch URL and the on-disk file.
 * @example
 * ```ts
 * dataSuffix("/en/hello/"); // "en/hello/index.json"
 * dataSuffix("/");          // "index.json"
 * ```
 */
export function dataSuffix(path: string): string {
  const queryless = path.split("?")[0] ?? path;
  let trimmed = queryless;

  // Drop any leading slashes so the suffix is outputDir-relative.
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);

  // Drop any trailing slashes so a single one can be reattached uniformly.
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed.length > 0 ? `${trimmed}/index.json` : "index.json";
}

/**
 * Decode a data suffix's percent-escapes so the on-disk file carries the literal
 * (decoded) name — servers decode the encoded fetch URL before resolving it against
 * the filesystem, so the file must match the DECODED request path. Falls back to
 * the raw suffix when it is not valid percent-encoding (a literal `%` in a page
 * path must not throw `URIError` mid-write).
 *
 * @param suffix - The computed data suffix (possibly percent-encoded).
 * @returns The decoded suffix, or the raw suffix on malformed escapes.
 * @example
 * ```ts
 * decodeSuffix("en/tags/a%20%26%20b/index.json"); // "en/tags/a & b/index.json"
 * ```
 */
function decodeSuffix(suffix: string): string {
  try {
    return decodeURIComponent(suffix);
  } catch {
    return suffix;
  }
}

/**
 * Compute the `outputDir`-relative data file for a page path, joining the trimmed
 * output dir with the DECODED {@link dataSuffix}. Shared by the Node writer and the
 * pure `fileFor` accessor so the written file and the reported path can never drift.
 * The suffix's percent-escapes are decoded ({@link decodeSuffix}) because servers
 * decode the encoded fetch URL before resolving it against literal file names —
 * matching how the page's own `…/index.html` is written (router `buildFilePath`).
 *
 * @param outputDir - The configured data output subdir (e.g. `"_data"` or `"_data/"`).
 * @param path - The page URL path (e.g. `/en/hello/`).
 * @returns The `outputDir`-relative file path (e.g. `_data/en/hello/index.json`).
 * @example
 * ```ts
 * relativeDataFile("_data", "/en/hello/"); // "_data/en/hello/index.json"
 * relativeDataFile("_data/", "/");         // "_data/index.json"
 * ```
 */
export function relativeDataFile(outputDir: string, path: string): string {
  const dir = outputDir.endsWith("/") ? outputDir.slice(0, -1) : outputDir;
  return `${dir}/${decodeSuffix(dataSuffix(path))}`;
}
