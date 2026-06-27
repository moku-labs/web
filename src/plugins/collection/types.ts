/**
 * @file collection plugin — type definitions (Standard tier).
 *
 * The `collection` plugin is the **static-data collection provider** — the
 * collection-keyed sibling of the page-path-keyed `data` plugin. It owns ONE
 * thing: the contract `(collection, shard) → persisted JSON file`. It knows
 * NOTHING about what the data *is* — no domain types appear here. A consumer
 * decides its own shard shape (`at`'s `T`).
 *
 *  - **Node (build):** `write(entries)` persists one JSON file per shard, keyed by
 *    `(collection, shard)` via {@link CollectionProvider.fileFor}. The build
 *    supplies the entries (it already authored the shards), so there is no
 *    expansion here.
 *  - **Browser (runtime):** `at(collection, shard)` fetches + caches that file as
 *    `unknown`, which the consumer reads on demand.
 *
 * The Node-only file-writing code (`node:fs`) is isolated behind a lazy `import()`
 * inside `write()`, so composing `collection` in a browser app keeps the bundle
 * free of `node:*`.
 */

/**
 * Configuration for {@link collectionPlugin}. All fields have defaults (see
 * `./config`).
 *
 * @example
 * ```ts
 * const cfg: CollectionConfig = { baseUrl: "/" };
 * ```
 */
export type CollectionConfig = {
  /**
   * READ side (browser): site-root URL prefix the client fetches the per-shard
   * JSON from. The collection name is the top directory under it, so the fetched
   * URL is `baseUrl + collection + "/" + shard + ".json"`. Default `"/"`.
   */
  baseUrl: string;
};

/** One build-authored shard to persist — the build produces these. */
export interface CollectionShard {
  /** The collection name — the top directory (e.g. `"bank"`). */
  collection: string;
  /**
   * The shard key WITHIN the collection (e.g. `"en/animals"`); may contain `/`,
   * which is preserved as a nested path. Maps to a file via
   * {@link CollectionProvider.fileFor}.
   */
  shard: string;
  /** The serializable data for this shard. */
  data: unknown;
}

/** Summary returned by {@link CollectionProvider.write} and cached in state. */
export interface CollectionWriteSummary {
  /** Number of per-shard JSON files written. */
  fileCount: number;
  /** Total bytes written across all files. */
  bytes: number;
  /** The written file paths, relative to the build `outDir`. */
  files: string[];
}

/**
 * Internal collection state. `lastWrite` records the most recent `write()` (Node);
 * `cache` memoizes fetched per-`(collection, shard)` data (browser, lazy). Both
 * empty until their respective side first runs.
 */
export interface CollectionState {
  /** Result of the last `write()`, or `null` if it has not run yet (Node). */
  lastWrite: CollectionWriteSummary | null;
  /** Per-`(collection, shard)` fetched data, cached after the first `at()` (browser). */
  cache: Map<string, unknown>;
}

/**
 * Public API mounted at `app.collection` — the static-data collection provider.
 * `write()` is the Node persist side; `at()` is the browser read side;
 * `urlFor`/`fileFor` are the pure URL convention shared by both so the written
 * file and fetched URL can never drift.
 *
 * @example
 * ```ts
 * // Node build (build supplies the shards it already authored):
 * await app.collection.write([{ collection: "bank", shard: "en/animals", data }]);
 *
 * // Browser: fetch a shard on demand, read by the consumer:
 * const raw = await app.collection.at("bank", "en/animals"); // unknown | null (null on failure)
 * ```
 */
export type CollectionProvider = {
  /**
   * READ (browser) — fetch (and cache) the persisted data for a `(collection,
   * shard)` key from `config.baseUrl`. Returns the raw parsed JSON as `unknown`;
   * returns `null` if the fetch or JSON parse fails.
   *
   * @param collection - The collection name (e.g. `"bank"`).
   * @param shard - The shard key within the collection (e.g. `"en/animals"`).
   * @returns The shard's raw data, or `null` on failure.
   */
  at(collection: string, shard: string): Promise<unknown | null>;
  /**
   * WRITE (Node) — persist one JSON file per entry, keyed by `(collection, shard)`
   * via {@link CollectionProvider.fileFor}. Called by the build after it authors
   * the shards. Lazily loads its `node:fs` writer, so it never contaminates a
   * browser bundle.
   *
   * @param entries - The per-shard data to persist.
   * @param options - Optional overrides.
   * @param options.outDir - Build output directory to write under (default `./dist`).
   * @returns A summary of the written files.
   */
  write(
    entries: readonly CollectionShard[],
    options?: { outDir?: string }
  ): Promise<CollectionWriteSummary>;
  /**
   * PURE — the browser fetch URL for a `(collection, shard)` key (e.g.
   * `("bank", "en/animals")` → `/bank/en/animals.json`). Shared with
   * {@link CollectionProvider.fileFor}.
   *
   * @param collection - The collection name.
   * @param shard - The shard key within the collection.
   * @returns The site-root-relative shard URL.
   */
  urlFor(collection: string, shard: string): string;
  /**
   * PURE — the `outDir`-relative file path for a `(collection, shard)` key (e.g.
   * `("bank", "en/animals")` → `bank/en/animals.json`). Shared with
   * {@link CollectionProvider.urlFor}.
   *
   * @param collection - The collection name.
   * @param shard - The shard key within the collection.
   * @returns The output-relative file path.
   */
  fileFor(collection: string, shard: string): string;
};
