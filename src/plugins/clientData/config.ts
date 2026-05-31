/**
 * @file clientData plugin — default configuration.
 */
import type { ClientDataConfig } from "./types";

/**
 * Typed default clientData config (R6: no inline `as`). `"fragment"` ships
 * pre-rendered HTML-in-JSON (hybrid, zero client render layer); `_data` is the
 * conventional sidecar output root relative to the build `outDir`.
 *
 * @example
 * ```ts
 * createPlugin("clientData", { config: defaultClientDataConfig });
 * ```
 */
export const defaultClientDataConfig: ClientDataConfig = {
  outputDir: "_data",
  payload: "fragment"
};
