/**
 * @file data plugin — config validation (runs at onInit).
 */
import type { DataConfig } from "./types";

/**
 * Reports whether a `baseUrl` value is invalid: it must be a string that is a
 * site-root-relative URL path (i.e. starting with "/").
 *
 * @param baseUrl - The candidate `baseUrl` value to check.
 * @returns `true` when `baseUrl` is not a string or does not start with "/".
 * @example
 * ```ts
 * isInvalidBaseUrl("/_data/"); // false
 * isInvalidBaseUrl("_data"); // true
 * ```
 */
function isInvalidBaseUrl(baseUrl: unknown): boolean {
  return typeof baseUrl !== "string" || !baseUrl.startsWith("/");
}

/**
 * Validates the resolved data config: the browser `baseUrl` must be a non-empty,
 * site-root-relative URL path.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `baseUrl` is empty or not a rooted URL path.
 * @example
 * ```ts
 * validateDataConfig({ outputDir: "_data", baseUrl: "/_data/" });
 * ```
 */
export function validateDataConfig(config: DataConfig): void {
  if (isInvalidBaseUrl(config.baseUrl)) {
    throw new Error(
      `[web] data.baseUrl: must be a site-root-relative URL path starting with "/" (e.g. "/_data/").`
    );
  }
}
