/**
 * @file collection plugin — config validation (runs at onInit).
 */
import type { CollectionConfig } from "./types";

/**
 * Reports whether a `baseUrl` value is invalid: it must be a string that ends with
 * a `"/"` so the collection name appends cleanly (`baseUrl + collection + "/" + …`).
 *
 * @param baseUrl - The candidate `baseUrl` value to check.
 * @returns `true` when `baseUrl` is not a string or does not end with "/".
 * @example
 * ```ts
 * isInvalidBaseUrl("/"); // false
 * isInvalidBaseUrl("/cdn"); // true
 * ```
 */
function isInvalidBaseUrl(baseUrl: unknown): boolean {
  return typeof baseUrl !== "string" || !baseUrl.endsWith("/");
}

/**
 * Validates the resolved collection config: the browser `baseUrl` must be a string
 * ending with `"/"` so the collection name appends cleanly.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `baseUrl` is not a string ending with "/".
 * @example
 * ```ts
 * validateCollectionConfig({ baseUrl: "/" });
 * ```
 */
export function validateCollectionConfig(config: CollectionConfig): void {
  if (isInvalidBaseUrl(config.baseUrl)) {
    throw new Error(
      `[web] collection.baseUrl: must be a URL prefix ending with "/" (e.g. "/" or "/cdn/").`
    );
  }
}
