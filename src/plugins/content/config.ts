/**
 * @file content plugin — default configuration skeleton (shell).
 */
import type { Config } from "./types";

/**
 * Typed default content config (R6: no inline `as`). The provider list defaults to
 * `[]`; a build MUST compose at least one (e.g. `fileSystemContent(...)`), enforced at
 * `onInit`. Source + pipeline options now live on the provider, not here.
 *
 * @example
 * ```ts
 * createPlugin("content", { config: defaultContentConfig });
 * ```
 */
export const defaultContentConfig: Config = {
  providers: []
};
