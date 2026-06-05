/**
 * @file data plugin — API factory (the agnostic data provider surface).
 *
 * Node-free by construction: this module statically imports only types + the pure
 * convention. The Node write side (`write()`) reaches its `node:fs` writer through
 * a lazy `await import("./writer")` at call time, so a browser bundle that composes
 * `data` for the read side never pulls `node:*`. The read side (`at()`) uses only
 * the isomorphic `loadJson` (whose Node branch is itself lazy).
 */
import { dataSuffix, relativeDataFile } from "./convention";
import { loadJson } from "./load-json";
import type { DataConfig, DataEntry, DataProvider, DataState, DataWriteSummary } from "./types";

/**
 * The plugin-context slice the data API factory consumes: mutable `state` and the
 * resolved `config`. Typed loosely so api.ts stays free of the kernel's full
 * plugin-context generic while remaining assignable from the execution context.
 *
 * @example
 * ```ts
 * const ctx: DataPluginContext = { state, config };
 * ```
 */
export type DataPluginContext = {
  /** Mutable plugin state (last write summary + per-path fetch cache). */
  state: DataState;
  /** Resolved plugin configuration. */
  config: DataConfig;
};

/**
 * Builds the data provider — the agnostic bridge. `write()` is the Node persist
 * side; `at()` is the browser read side; `urlFor`/`fileFor` are the pure
 * convention. No `onStart`/`onStop` (holds no long-lived resource).
 *
 * @param ctx - The data plugin context.
 * @returns The {@link DataProvider} mounted at `app.data`.
 * @example
 * ```ts
 * const api = dataApi(ctx);
 * await api.write([{ path: "/en/hello/", data: article }]); // Node build
 * await api.at("/en/hello/");                               // browser
 * ```
 */
export function dataApi(ctx: DataPluginContext): DataProvider {
  return {
    /**
     * READ (browser) — fetch (and cache) the persisted data for a page path.
     * Returns the raw JSON as `unknown`, which the route uses directly as `ctx.data`
     * (no route `.parse()`); returns `null` if the fetch or JSON parse fails (so
     * `spa` can fall back to HTML).
     *
     * @param path - The page URL path (e.g. `/en/hello/`).
     * @returns The page's raw data, or `null` on failure.
     * @example
     * ```ts
     * const raw = await api.at("/en/hello/");
     * ```
     */
    async at(path: string): Promise<unknown | null> {
      if (ctx.state.cache.has(path)) return ctx.state.cache.get(path);
      try {
        const data = await loadJson<unknown>(`${ctx.config.baseUrl}${dataSuffix(path)}`);
        ctx.state.cache.set(path, data);
        return data;
      } catch {
        // eslint-disable-next-line unicorn/no-null -- "fetch or JSON parse failed → fall back" signal
        return null;
      }
    },
    /**
     * WRITE (Node) — persist one JSON file per entry, keyed by page path. Called by
     * `build` after it expands routes. Lazily loads its `node:fs` writer (keeping a
     * browser bundle node-free).
     *
     * @param entries - The per-page data to persist.
     * @param options - Optional `{ outDir }` override (defaults to `./dist`).
     * @param options.outDir - Build output directory the write happens under.
     * @returns A summary of the written files.
     * @example
     * ```ts
     * await api.write([{ path: "/en/hello/", data: article }], { outDir: "dist" });
     * ```
     */
    async write(
      entries: readonly DataEntry[],
      options?: { outDir?: string }
    ): Promise<DataWriteSummary> {
      const { writeData } = await import("./writer");
      return writeData(ctx, entries, options);
    },
    /**
     * PURE — the browser fetch URL for a page path.
     *
     * @param path - The page URL path.
     * @returns The site-root-relative data URL.
     * @example
     * ```ts
     * api.urlFor("/en/hello/"); // "/_data/en/hello/index.json"
     * ```
     */
    urlFor(path: string): string {
      return `${ctx.config.baseUrl}${dataSuffix(path)}`;
    },
    /**
     * PURE — the `outDir`-relative file path for a page path.
     *
     * @param path - The page URL path.
     * @returns The output-relative file path.
     * @example
     * ```ts
     * api.fileFor("/en/hello/"); // "_data/en/hello/index.json"
     * ```
     */
    fileFor(path: string): string {
      return relativeDataFile(ctx.config.outputDir, path);
    }
  };
}
