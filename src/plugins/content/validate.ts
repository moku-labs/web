/**
 * @file content plugin — config validation skeleton (shell).
 */
import type { Config } from "./types";

/**
 * Validates the resolved content config (fail-fast at `createApp`). Throws when no
 * content provider is composed — content is useless without a source. Errors use the
 * `[web]` prefix. (Per-provider options like `contentDir` are validated by the provider.)
 *
 * @param config - Resolved content plugin configuration.
 * @throws {Error} If `providers` is empty.
 * @example
 * ```ts
 * validateContentConfig(config);
 * ```
 */
export function validateContentConfig(config: Config): void {
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error(
      "[web] content: no provider composed.\n  Add fileSystemContent(...) to pluginConfigs.content.providers."
    );
  }
}
