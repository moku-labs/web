/**
 * @file head — Standard Plugin wiring harness (logic in primitives/compose/api/config).
 * @see README.md
 */
import { createPlugin } from "../../config";
import { i18nPlugin } from "../i18n";
import { routerPlugin } from "../router";
import { sitePlugin } from "../site";
import { createApi } from "./api";
import { defaultConfig, normalizeHeadConfig } from "./config";
import { headHelpers } from "./helpers";
import { createState } from "./state";

export const headPlugin = createPlugin("head", {
  depends: [sitePlugin, i18nPlugin, routerPlugin],
  helpers: headHelpers,
  config: defaultConfig,
  createState,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; validation + normalization in config.ts
  onInit(ctx) {
    ctx.state.defaults = normalizeHeadConfig(ctx.config);
  }
});

// Re-export the 8 pure SEO primitives (the only exports of ./primitives) for the
// framework index, which surfaces them for direct use in a route's `.head()` callback.
export * from "./primitives";
