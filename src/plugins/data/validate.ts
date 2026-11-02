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
 * Reports whether a `preload` value is invalid: unset, `"none"` and `"all"` are valid.
 *
 * @param preload - The candidate `preload` value to check.
 * @returns `true` when `preload` is set to anything other than `"none"` or `"all"`.
 * @example
 * ```ts
 * isInvalidPreload("all"); // false
 * isInvalidPreload("al"); // true
 * ```
 */
function isInvalidPreload(preload: unknown): boolean {
  return preload !== undefined && preload !== "none" && preload !== "all";
}

/**
 * Validates the resolved data config: the browser `baseUrl` must be a non-empty,
 * site-root-relative URL path, and `preload` must be `"none"` or `"all"`.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `baseUrl` is empty or not a rooted URL path, or `preload` is unknown.
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
  if (isInvalidPreload(config.preload)) {
    throw new Error(
      `[web] data.preload: must be "none" or "all" (got ${JSON.stringify(config.preload)}).\n` +
        `  Set pluginConfigs.data.preload to "all" in the Node app and the browser app, or remove it.`
    );
  }
}
