/**
 * @file content plugin — config validation skeleton (shell + provider options).
 */
import type { Config, FileSystemContentOptions } from "./types";

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

/**
 * Validates the `fileSystemContent` provider options (fail-fast at provider
 * construction). Throws when `mermaid` is enabled without `trustedContent: true`:
 * mermaid output is raw inline SVG, which the sanitize pass (the untrusted-content
 * XSS boundary) would strip — so the combination can never work. Errors use the
 * `[web]` prefix.
 *
 * @param options - The provider options to validate.
 * @throws {Error} If `mermaid` is enabled while `trustedContent` is not `true`.
 * @example
 * ```ts
 * validateFileSystemContentOptions({ contentDir: "./content", trustedContent: true, mermaid: true });
 * ```
 */
export function validateFileSystemContentOptions(options: FileSystemContentOptions): void {
  const mermaidEnabled = Boolean(options.mermaid);
  if (mermaidEnabled && options.trustedContent !== true) {
    throw new Error(
      "[web] content: `mermaid` requires `trustedContent: true`.\n" +
        "  Mermaid diagrams render to raw inline SVG, which the sanitize pass would strip.\n" +
        "  Set trustedContent: true ONLY for fully author-controlled Markdown."
    );
  }
}
