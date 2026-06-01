/**
 * @file data plugin — the pure URL/file convention (no `node:*`, no DOM).
 *
 * ONE function maps a page path to its data suffix, so the browser fetch URL
 * (`baseUrl + suffix`) and the on-disk file (`outputDir + "/" + suffix`) are
 * derived from the same source and cannot drift. The data file mirrors the page
 * URL exactly, mirroring how `build` writes `…/index.html` per page:
 *   `/`            → `index.json`
 *   `/en/hello/`   → `en/hello/index.json`
 *   `/en/hello`    → `en/hello/index.json`  (trailing slash normalized)
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
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed.length > 0 ? `${trimmed}/index.json` : "index.json";
}
