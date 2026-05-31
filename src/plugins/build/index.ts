/**
 * @file build — Complex plugin: SSG orchestrator (wiring harness only).
 * @see README.md
 */
import { createPlugin } from "../../config";
import { contentPlugin } from "../content";
import { headPlugin } from "../head";
import { i18nPlugin } from "../i18n";
import { routerPlugin } from "../router";
import { sitePlugin } from "../site";
import { createApi, defaultConfig, validateConfig } from "./api";
import { createEvents } from "./events";
import { createState } from "./state";

/**
 * Build plugin — the static-site-generation orchestrator. Renders every route to
 * `outDir`, and optionally emits feeds, a sitemap, optimized images, and OG
 * images. Depends on site, i18n, content, router, and head; emits `build:phase`.
 *
 * @example Configure the production build
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     build: {
 *       outDir: "dist",
 *       minify: true,
 *       feeds: true,
 *       sitemap: true,
 *       images: true,
 *       ogImage: false // or an object to enable + configure OG-image generation
 *     }
 *   }
 * });
 * ```
 */
export const buildPlugin = createPlugin("build", {
  depends: [sitePlugin, i18nPlugin, contentPlugin, routerPlugin, headPlugin],
  config: defaultConfig,
  createState,
  events: createEvents,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; validation in api.ts
  onInit: ctx => validateConfig(ctx.config)
});
