/**
 * @file `loadJson` — the data plugin's isomorphic JSON read primitive (the
 * SSG↔SPA seam). Internal to the `data` plugin (NOT a framework-root export):
 * `data.load(locale)` uses it, and consumers read through `app.data.load(locale)`.
 *
 * A read runs in BOTH worlds: on Node it reads the emitted data file from disk;
 * on the client (browser) it fetches the same data over HTTP. `loadJson` is the
 * single point where those two worlds differ — everything above it (the route's
 * `load`/`render`) is shared, so SSR/client parity is structural, not hoped-for.
 *
 * The browser path uses the `fetch` global. The Node path lazy-imports
 * `node:fs/promises` via `await import(...)`, so a browser bundle that includes
 * `loadJson` never statically pulls `node:*` (the bundler splits the Node branch
 * into its own chunk that the browser never loads).
 */

/**
 * Read + parse a JSON resource, isomorphically. In a browser (`document`
 * defined) it `fetch`es `pathOrUrl`; on Node it reads the file from disk. Throws
 * on a failed fetch or unreadable file so the caller (`route.load`/`data.load`)
 * can decide whether to fall back.
 *
 * @template T - The expected shape of the parsed JSON.
 * @param pathOrUrl - A site-root URL (browser) or filesystem path (Node).
 * @returns The parsed JSON, typed as `T`.
 * @throws {Error} If the browser fetch is not OK, or the Node file read fails.
 * @example
 * ```ts
 * // Browser: fetch("/_data/en/articles.json")
 * // Node:    read "dist/_data/en/articles.json"
 * const articles = await loadJson<Article[]>("/_data/en/articles.json");
 * ```
 */
export async function loadJson<T>(pathOrUrl: string): Promise<T> {
  if (typeof document === "undefined") {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(pathOrUrl, "utf8")) as T;
  }
  const response = await fetch(pathOrUrl);
  if (!response.ok) {
    throw new Error(`[web] loadJson: failed to fetch ${pathOrUrl} (${String(response.status)}).`);
  }
  return response.json() as Promise<T>;
}
