/**
 * @file collection — Standard tier plugin (wiring-only). The static-data
 * COLLECTION provider — the collection-keyed sibling of the page-path-keyed `data`
 * plugin.
 *
 * Owns ONE contract — `(collection, shard) → persisted JSON file` — and nothing
 * about what the data is: `write(entries)` persists per-shard JSON on Node (the
 * build supplies the shards it already authored); `at(collection, shard)` fetches +
 * caches it in the browser as `unknown`, read on demand by the consumer. NOT a
 * framework default — the consumer composes it where needed (Node build AND/OR
 * browser app).
 *
 * **No hard `depends`** — fully browser-composable; the `node:fs` writer is behind
 * a lazy `import()` inside `write()`. Build ordering is a call-site contract: the
 * build writes shards during/after its pages phase, via `app.collection.write`.
 * No `onStart`/`onStop`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { collectionApi } from "./api";
import { defaultCollectionConfig } from "./config";
import { createCollectionState } from "./state";
import { validateCollectionConfig } from "./validate";

/**
 * Collection plugin — the static-data collection provider. Mounts
 * `write(entries)` (Node persist), `at(collection, shard)` (browser read), and the
 * pure `urlFor`/`fileFor` convention at `app.collection`.
 *
 * @example
 * ```ts
 * // Node build: write build-authored shards during/after the build's pages phase.
 * const app = createApp({ plugins: [collectionPlugin, buildPlugin] });
 * await app.build.run();
 * await app.collection.write([{ collection: "bank", shard: "en/animals", data }]);
 *
 * // Browser app: compose `collectionPlugin` too; fetch a shard on demand.
 * const raw = await app.collection.at("bank", "en/animals"); // unknown | null
 * ```
 */
export const collectionPlugin = createPlugin("collection", {
  config: defaultCollectionConfig,
  createState: createCollectionState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateCollectionConfig(ctx.config),
  api: collectionApi
});
