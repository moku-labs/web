/**
 * site — Micro tier. Multi-file layout (index wiring + api.ts + types.ts) so
 * index.ts stays within the ≤30-line wiring-only hook; logic lives in api.ts.
 *
 * Holds global, frozen site metadata (name, url, author, description) and
 * constructs canonical URLs. Consumed by router/head/build via
 * `ctx.require(sitePlugin)`. No events, no dependencies, no state.
 *
 * @file site plugin wiring harness.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createSiteApi, validateSiteConfig } from "./api";
import type { Config } from "./types";

/** Typed default config (R6: no inline `as`). Consumers override via `pluginConfigs.site`. */
const defaultConfig: Config = { name: "", url: "", author: "", description: "" };

/**
 * Site plugin — holds global, frozen site metadata (name, url, author,
 * description) and builds canonical URLs. Consumed by router, head, and build.
 * `name` and `url` must be non-empty (validated at `onInit`).
 *
 * @example Set your site identity
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     site: {
 *       name: "My Blog",
 *       url: "https://blog.dev",
 *       author: "Ada Lovelace",
 *       description: "Notes on computing"
 *     }
 *   }
 * });
 * ```
 */
export const sitePlugin = createPlugin("site", {
  config: defaultConfig,
  onInit: validateSiteConfig,
  api: createSiteApi
});
