/**
 * @file content plugin — default configuration skeleton.
 */
import type { Config } from "./types";

/**
 * Typed default content config (R6: no inline `as`). Framework default
 * remark/rehype plugin arrays live in `pipeline/plugins.ts`, NOT here — a config
 * array default would be wiped by the shallow merge; the optional extra arrays
 * default to `[]` so consumer additions concatenate cleanly.
 *
 * @example
 * ```ts
 * createPlugin("content", { config: defaultContentConfig });
 * ```
 */
export const defaultContentConfig: Config = {
  contentDir: "./src/content",
  trustedContent: false,
  extraRemarkPlugins: [],
  extraRehypePlugins: [],
  shikiTheme: "github-dark"
};
