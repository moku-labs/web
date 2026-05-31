/**
 * @file data plugin — default configuration.
 */
import type { DataConfig } from "./types";

/**
 * Typed default data config (R6: no inline `as`). `outputDir` is the WRITE path
 * (filesystem, relative to the build `outDir`); `baseUrl` is the matching READ URL
 * (site-root-relative) the browser fetches from — the defaults agree
 * (`"_data"` ↔ `"/_data/"`). `"fragment"` ships pre-rendered HTML-in-JSON (hybrid,
 * zero client render layer).
 *
 * @example
 * ```ts
 * createPlugin("data", { config: defaultDataConfig });
 * ```
 */
export const defaultDataConfig: DataConfig = {
  outputDir: "_data",
  baseUrl: "/_data/",
  payload: "fragment"
};
