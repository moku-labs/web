/**
 * @file data plugin — config validation (runs at onInit).
 */
import type { DataConfig } from "./types";

/**
 * Validates the resolved data config: the `payload` discriminant must be a known
 * mode and the browser `baseUrl` must be a non-empty, slash-wrapped URL path. The
 * full emit/read pipelines are wired in build waves 3/4.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `payload` is invalid, or `baseUrl` is empty / not a rooted URL path.
 * @example
 * ```ts
 * validateDataConfig({ outputDir: "_data", baseUrl: "/_data/", payload: "fragment" });
 * ```
 */
export function validateDataConfig(config: DataConfig): void {
  if (config.payload !== "fragment" && config.payload !== "data") {
    throw new Error(
      `[web] data.payload: invalid value "${String(config.payload)}" (expected "fragment" or "data").`
    );
  }
  if (typeof config.baseUrl !== "string" || !config.baseUrl.startsWith("/")) {
    throw new Error(
      `[web] data.baseUrl: must be a site-root-relative URL path starting with "/" (e.g. "/_data/").`
    );
  }
}
