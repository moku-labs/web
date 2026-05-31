/**
 * @file data plugin — default configuration.
 */
import type { DataConfig } from "./types";

/**
 * Typed default data config (R6: no inline `as`). `"fragment"` ships
 * pre-rendered HTML-in-JSON (hybrid, zero client render layer); `_data` is the
 * conventional sidecar output root relative to the build `outDir`.
 *
 * @example
 * ```ts
 * createPlugin("data", { config: defaultDataConfig });
 * ```
 */
export const defaultDataConfig: DataConfig = {
  outputDir: "_data",
  payload: "fragment"
};
