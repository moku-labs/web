/**
 * @file deploy plugin — default configuration constant.
 */
import type { Config } from "./types";

/**
 * Default deploy configuration. Consumers override individual fields via
 * `pluginConfigs.deploy`. Declared as a typed const (no inline `as` assertion).
 *
 * @example
 * ```ts
 * createPlugin("deploy", { config: defaultConfig });
 * ```
 */
export const defaultConfig: Config = {
  target: "cloudflare-pages",
  outDir: "dist",
  productionBranch: "main",
  scrubAllowlist: ["CLOUDFLARE_ACCOUNT_ID"],
  compatibilityDate: "2024-01-01",
  ci: false
};
