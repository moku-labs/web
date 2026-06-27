/**
 * @file collection plugin — default configuration.
 */
import type { CollectionConfig } from "./types";

/**
 * Typed default collection config (R6: no inline `as`). `baseUrl` is the READ-side
 * site-root URL prefix the browser fetches shards from; the collection name is the
 * top directory under it. The default `"/"` serves shards straight from the site
 * root (e.g. `/bank/en/animals.json`).
 *
 * @example
 * ```ts
 * createPlugin("collection", { config: defaultCollectionConfig });
 * ```
 */
export const defaultCollectionConfig: CollectionConfig = {
  baseUrl: "/"
};
