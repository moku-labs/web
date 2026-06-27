/**
 * @file collection plugin — API factory (the collection provider surface).
 *
 * Node-free by construction: this module statically imports only types + the pure
 * convention + the node-free `read` primitive. The Node write side (`write()`)
 * reaches its `node:fs` writer through a lazy `await import("./writer")` at call
 * time, so a browser bundle that composes `collection` for the read side never
 * pulls `node:*`. The read side (`at()`) uses only the `fetch`-based
 * `loadCollectionShard`.
 */
import { collectionUrl, relativeShardFile } from "./convention";
import { loadCollectionShard } from "./read";
import type {
  CollectionConfig,
  CollectionProvider,
  CollectionShard,
  CollectionState,
  CollectionWriteSummary
} from "./types";

/**
 * The plugin-context slice the collection API factory consumes: mutable `state` and
 * the resolved `config`. Typed loosely so api.ts stays free of the kernel's full
 * plugin-context generic while remaining assignable from the execution context.
 *
 * @example
 * ```ts
 * const ctx: CollectionPluginContext = { state, config };
 * ```
 */
export type CollectionPluginContext = {
  /** Mutable plugin state (last write summary + per-shard fetch cache). */
  state: CollectionState;
  /** Resolved plugin configuration. */
  config: CollectionConfig;
};

/**
 * Builds the collection provider — the static-data bridge. `write()` is the Node
 * persist side; `at()` is the browser read side; `urlFor`/`fileFor` are the pure
 * convention. No `onStart`/`onStop` (holds no long-lived resource).
 *
 * @param ctx - The collection plugin context.
 * @returns The {@link CollectionProvider} mounted at `app.collection`.
 * @example
 * ```ts
 * const api = collectionApi(ctx);
 * await api.write([{ collection: "bank", shard: "en/animals", data }]); // Node build
 * await api.at("bank", "en/animals");                                   // browser
 * ```
 */
export function collectionApi(ctx: CollectionPluginContext): CollectionProvider {
  return {
    /**
     * READ (browser) — fetch (and cache) the persisted data for a `(collection,
     * shard)` key. Returns the raw JSON as `unknown`; returns `null` if the fetch
     * or JSON parse fails (so the consumer can fall back). Wraps the throwing
     * {@link loadCollectionShard} reader into a soft null-returning app read.
     *
     * @param collection - The collection name (e.g. `"bank"`).
     * @param shard - The shard key within the collection (e.g. `"en/animals"`).
     * @returns The shard's raw data, or `null` on failure.
     * @example
     * ```ts
     * const raw = await api.at("bank", "en/animals");
     * ```
     */
    async at(collection: string, shard: string): Promise<unknown | null> {
      const key = `${collection}/${shard}`;
      if (ctx.state.cache.has(key)) return ctx.state.cache.get(key);
      try {
        const data = await loadCollectionShard(ctx.config.baseUrl, collection, shard);
        ctx.state.cache.set(key, data);
        return data;
      } catch {
        // eslint-disable-next-line unicorn/no-null -- "fetch or JSON parse failed → fall back" signal
        return null;
      }
    },
    /**
     * WRITE (Node) — persist one JSON file per entry, keyed by `(collection,
     * shard)`. Called by the build after it authors the shards. Lazily loads its
     * `node:fs` writer (keeping a browser bundle node-free).
     *
     * @param entries - The per-shard data to persist.
     * @param options - Optional `{ outDir }` override (defaults to `./dist`).
     * @param options.outDir - Build output directory the write happens under.
     * @returns A summary of the written files.
     * @example
     * ```ts
     * await api.write([{ collection: "bank", shard: "ru", data }], { outDir: "dist" });
     * ```
     */
    async write(
      entries: readonly CollectionShard[],
      options?: { outDir?: string }
    ): Promise<CollectionWriteSummary> {
      const { writeCollection } = await import("./writer");
      return writeCollection(ctx, entries, options);
    },
    /**
     * PURE — the browser fetch URL for a `(collection, shard)` key.
     *
     * @param collection - The collection name.
     * @param shard - The shard key within the collection.
     * @returns The site-root-relative shard URL.
     * @example
     * ```ts
     * api.urlFor("bank", "en/animals"); // "/bank/en/animals.json"
     * ```
     */
    urlFor(collection: string, shard: string): string {
      return collectionUrl(ctx.config.baseUrl, collection, shard);
    },
    /**
     * PURE — the `outDir`-relative file path for a `(collection, shard)` key.
     *
     * @param collection - The collection name.
     * @param shard - The shard key within the collection.
     * @returns The output-relative file path.
     * @example
     * ```ts
     * api.fileFor("bank", "en/animals"); // "bank/en/animals.json"
     * ```
     */
    fileFor(collection: string, shard: string): string {
      return relativeShardFile(collection, shard);
    }
  };
}
