/**
 * @file collection plugin — the pure URL/file convention (no `node:*`, no DOM).
 *
 * ONE function maps a `(collection, shard)` key to its shard suffix, so the browser
 * fetch URL (`baseUrl + suffix`) and the on-disk file (`outDir + "/" + suffix`) are
 * derived from the same source and cannot drift. The collection name is the top
 * directory and the shard becomes a `.json` file beneath it (its INTERNAL slashes
 * are kept as nested dirs):
 *   ("bank", "en/animals") → "bank/en/animals.json"
 *   ("bank", "ru")         → "bank/ru.json"
 *   ("/bank/", "/en/")     → "bank/en.json"  (outer slashes trimmed)
 *
 * Encoding split: the FETCH suffix ({@link shardSuffix}) keeps the key's
 * percent-encoding (the browser requests the encoded path); the FILE path
 * ({@link relativeShardFile}) decodes it so the on-disk name is literal.
 */

/**
 * Strip leading/trailing slashes from `collection` and `shard` (keeping the
 * shard's INTERNAL slashes as nested path segments), then join them as
 * `` `${collection}/${shard}.json` `` — the suffix shared by the fetch URL and the
 * on-disk file.
 *
 * @param collection - The collection name (e.g. `"bank"`).
 * @param shard - The shard key within the collection (e.g. `"en/animals"`).
 * @returns The shard suffix (e.g. `"bank/en/animals.json"`).
 * @example
 * ```ts
 * shardSuffix("bank", "en/animals"); // "bank/en/animals.json"
 * shardSuffix("/bank/", "/ru/");     // "bank/ru.json"
 * ```
 */
export function shardSuffix(collection: string, shard: string): string {
  // Drop outer slashes from both parts; keep the shard's internal slashes.
  const trimmedCollection = trimSlashes(collection);
  const trimmedShard = trimSlashes(shard);
  return `${trimmedCollection}/${trimmedShard}.json`;
}

/**
 * Strip any leading and trailing slashes from a path segment, leaving its internal
 * slashes intact.
 *
 * @param segment - The raw `collection` or `shard` value.
 * @returns The segment without outer slashes.
 * @example
 * ```ts
 * trimSlashes("/en/animals/"); // "en/animals"
 * ```
 */
function trimSlashes(segment: string): string {
  let trimmed = segment;
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/**
 * Compute the browser fetch URL for a `(collection, shard)` key: the `baseUrl`
 * prefix joined with the {@link shardSuffix}. Exported so standalone consumers can
 * derive the same URL without composing the plugin.
 *
 * @param baseUrl - The site-root URL prefix (ends with `/`, e.g. `"/"`).
 * @param collection - The collection name (e.g. `"bank"`).
 * @param shard - The shard key within the collection (e.g. `"en/animals"`).
 * @returns The site-root-relative shard URL (e.g. `/bank/en/animals.json`).
 * @example
 * ```ts
 * collectionUrl("/", "bank", "en/animals"); // "/bank/en/animals.json"
 * ```
 */
export function collectionUrl(baseUrl: string, collection: string, shard: string): string {
  return `${baseUrl}${shardSuffix(collection, shard)}`;
}

/**
 * Decode a shard suffix's percent-escapes so the on-disk file carries the literal
 * name (servers decode the encoded fetch URL before filesystem lookup). Falls back
 * to the raw suffix on malformed escapes.
 *
 * @param suffix - The computed shard suffix (possibly percent-encoded).
 * @returns The decoded suffix, or the raw suffix on malformed escapes.
 * @example
 * ```ts
 * decodeSuffix("bank/en/a%20%26%20b.json"); // "bank/en/a & b.json"
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
 * Compute the `outDir`-relative shard file for a `(collection, shard)` key — the
 * DECODED {@link shardSuffix} (servers resolve the decoded request path against
 * literal file names). The collection name IS the top directory, so there is no
 * extra output-dir wrapper. Shared by the Node writer and the pure `fileFor`
 * accessor so the written file and the reported path never drift.
 *
 * @param collection - The collection name (e.g. `"bank"`).
 * @param shard - The shard key within the collection (e.g. `"en/animals"`).
 * @returns The `outDir`-relative file path (e.g. `bank/en/animals.json`).
 * @example
 * ```ts
 * relativeShardFile("bank", "en/animals"); // "bank/en/animals.json"
 * relativeShardFile("bank", "a%20%26%20b"); // "bank/a & b.json"
 * ```
 */
export function relativeShardFile(collection: string, shard: string): string {
  return decodeSuffix(shardSuffix(collection, shard));
}
