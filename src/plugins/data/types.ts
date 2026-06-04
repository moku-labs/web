/**
 * @file data plugin — type definitions (Standard tier).
 *
 * The `data` plugin is the **agnostic data provider** for the SSG→DATA→SPA pattern.
 * It owns ONE thing: the contract `page path → persisted JSON file`. It knows
 * NOTHING about what the data *is* — no domain types appear here. A route decides
 * its own data shape (`load`'s return).
 *
 *  - **Node (build):** `write(entries)` persists one JSON file per page, keyed by
 *    the page's URL via {@link DataProvider.fileFor}. `build` supplies the entries
 *    (it already expanded the routes), so there is no duplicate expansion here.
 *  - **Browser (runtime):** `at(path)` fetches + caches that file as `unknown`; the
 *    route's `parse` validates it into the route's data type before `render`.
 *
 * The Node-only file-writing code (`node:fs`) is isolated behind a lazy `import()`
 * inside `write()`, so composing `data` in a browser app keeps the bundle free of
 * `node:*`.
 */

/**
 * Configuration for {@link dataPlugin}. All fields have defaults (see `./config`).
 *
 * @example
 * ```ts
 * const cfg: DataConfig = { outputDir: "_data", baseUrl: "/_data/" };
 * ```
 */
export type DataConfig = {
  /**
   * WRITE side (Node): output subdir relative to the build `outDir`, a filesystem
   * path where `write()` persists the per-page JSON. Default `"_data"`.
   */
  outputDir: string;
  /**
   * READ side (browser): site-root-relative URL the client fetches the per-page
   * JSON from. A different domain from {@link DataConfig.outputDir} (a filesystem
   * path); keep consistent (`"/" + trim(outputDir) + "/"`). Default `"/_data/"`.
   */
  baseUrl: string;
};

/** One page's data to persist — `build` produces these from its route expansion. */
export interface DataEntry {
  /** The page's URL path (e.g. `/en/hello/`); maps to a file via {@link DataProvider.fileFor}. */
  path: string;
  /** The serializable data for this page (the route's `load`/projection output). */
  data: unknown;
}

/** Summary returned by {@link DataProvider.write} and cached in state. */
export interface DataWriteSummary {
  /** Number of per-page JSON files written. */
  fileCount: number;
  /** Total bytes written across all files. */
  bytes: number;
  /** The written file paths, relative to the build `outDir`. */
  files: string[];
}

/**
 * Internal data state. `lastWrite` records the most recent `write()` (Node);
 * `cache` memoizes fetched per-path data (browser, lazy). Both empty until their
 * respective side first runs.
 */
export interface DataState {
  /** Result of the last `write()`, or `null` if it has not run yet (Node). */
  lastWrite: DataWriteSummary | null;
  /** Per-path fetched data, cached after the first `at(path)` (browser). */
  cache: Map<string, unknown>;
}

/**
 * Public API mounted at `app.data` — the agnostic data provider. `write()` is the
 * Node persist side; `at()` is the browser read side; `urlFor`/`fileFor` are the
 * pure URL convention shared by both so the written file and fetched URL can never
 * drift.
 *
 * @example
 * ```ts
 * // Node build (build supplies the entries it already expanded):
 * await app.data.write([{ path: "/en/hello/", data: article }]);
 *
 * // Browser (inside spa nav): fetch the page's data, used directly as ctx.data:
 * const raw = await app.data.at("/en/hello/"); // unknown | null
 * ```
 */
export type DataProvider = {
  /**
   * READ (browser) — fetch (and cache) the persisted data for a page path from
   * `config.baseUrl`. Returns the raw parsed JSON as `unknown` (used directly as
   * the route's `ctx.data`), or `null` if the fetch/parse fails.
   *
   * @param path - The page URL path (e.g. `/en/hello/`).
   * @returns The page's raw data, or `null` on failure.
   */
  at(path: string): Promise<unknown | null>;
  /**
   * WRITE (Node) — persist one JSON file per entry, keyed by page path via
   * {@link DataProvider.fileFor}. Called by `build` after it expands routes (no
   * duplicate expansion). Lazily loads its `node:fs` writer, so it never
   * contaminates a browser bundle.
   *
   * @param entries - The per-page data to persist.
   * @param options - Optional overrides.
   * @param options.outDir - Build output directory to write under (default `./dist`).
   * @returns A summary of the written files.
   */
  write(entries: readonly DataEntry[], options?: { outDir?: string }): Promise<DataWriteSummary>;
  /**
   * PURE — the browser fetch URL for a page path (e.g. `/en/hello/` →
   * `/_data/en/hello/index.json`). Shared with {@link DataProvider.fileFor}.
   *
   * @param path - The page URL path.
   * @returns The site-root-relative data URL.
   */
  urlFor(path: string): string;
  /**
   * PURE — the `outDir`-relative file path for a page path (e.g. `/en/hello/` →
   * `_data/en/hello/index.json`). Shared with {@link DataProvider.urlFor}.
   *
   * @param path - The page URL path.
   * @returns The output-relative file path.
   */
  fileFor(path: string): string;
};
