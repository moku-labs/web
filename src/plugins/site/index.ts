/**
 * site — Micro Plugin skeleton (multi-file: shared Config/Api types).
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

export const sitePlugin = createPlugin("site", {
  config: defaultConfig,
  onInit: validateSiteConfig,
  api: createSiteApi
});
