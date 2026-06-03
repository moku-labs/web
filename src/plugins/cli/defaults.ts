/**
 * @file cli plugin — default configuration constant.
 */
import type { Config } from "./types";

/**
 * Default cli configuration. Consumers override individual fields via
 * `pluginConfigs.cli`. Declared as a typed const (no inline `as` assertion).
 *
 * @example
 * ```ts
 * createPlugin("cli", { config: defaultConfig });
 * ```
 */
export const defaultConfig: Config = {
  outDir: "dist",
  port: 4173,
  watchDirs: ["content", "src"],
  debounceMs: 150,
  notFoundFile: "404.html",
  liveReload: true
};
