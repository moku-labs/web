/**
 * @file data plugin — config validation (runs at onInit).
 */
import type { DataConfig } from "./types";

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
  if (typeof config.baseUrl !== "string" || !config.baseUrl.startsWith("/")) {
    throw new Error(
      `[web] data.baseUrl: must be a site-root-relative URL path starting with "/" (e.g. "/_data/").`
    );
  }
}
