/**
 * @file content plugin — config validation skeleton.
 */
import type { Config } from "./types";

/**
 * Validates the resolved content config (fail-fast at `createApp`). Throws when
 * `contentDir` is missing/blank or when `trustedContent` is not a boolean.
 * Errors use the `[web]` prefix.
 *
 * @param config - Resolved content plugin configuration.
 * @throws {Error} If `contentDir` is missing/blank or `trustedContent` is not boolean.
 * @example
 * ```ts
 * validateContentConfig(config);
 * ```
 */
export function validateContentConfig(config: Config): void {
  if (typeof config.contentDir !== "string" || config.contentDir.trim() === "") {
    throw new Error(
      "[web] content.contentDir is required.\n  Set pluginConfigs.content.contentDir to your content directory."
    );
  }
  if (typeof config.trustedContent !== "boolean") {
    throw new TypeError("[web] content.trustedContent must be a boolean.");
  }
}
