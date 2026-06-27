/**
 * @file `loadCollectionShard` — the collection plugin's standalone BROWSER read
 * primitive. Internal to the `collection` plugin AND exported for standalone
 * consumers: `collection.at(...)` wraps it, and a room-layer consumer can import it
 * directly from `@moku-labs/web/browser`.
 *
 * Unlike the `data` plugin's isomorphic `loadJson`, this uses the `fetch` global
 * DIRECTLY (no `node:fs` branch). Consumers — and tests — rely on `fetch` even
 * under Node test environments, so there is no document sniffing here: a shard is
 * always fetched over HTTP from the build-authored URL. This keeps the module
 * fully node-free.
 */
import { collectionUrl } from "./convention";

/**
 * Fetch + parse a build-authored collection shard over HTTP. Builds the shard URL
 * via {@link collectionUrl}, fetches it, and throws on a non-OK response so the
 * caller (`collection.at`) can decide whether to fall back.
 *
 * @template T - The expected shape of the parsed shard JSON.
 * @param baseUrl - The site-root URL prefix (ends with `/`, e.g. `"/"`).
 * @param collection - The collection name (e.g. `"bank"`).
 * @param shard - The shard key within the collection (e.g. `"en/animals"`).
 * @returns The parsed shard JSON, typed as `T`.
 * @throws {Error} If the fetch is not OK.
 * @example
 * ```ts
 * const animals = await loadCollectionShard<Animal[]>("/", "bank", "en/animals");
 * ```
 */
export async function loadCollectionShard<T>(
  baseUrl: string,
  collection: string,
  shard: string
): Promise<T> {
  const url = collectionUrl(baseUrl, collection, shard);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[web] collection: failed to fetch ${url} (${String(response.status)}).`);
  }
  return response.json() as Promise<T>;
}
