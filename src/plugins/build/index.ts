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

export const buildPlugin = createPlugin("build", {
  depends: [sitePlugin, i18nPlugin, contentPlugin, routerPlugin, headPlugin],
  config: defaultConfig,
  createState,
  events: createEvents,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; validation in api.ts
  onInit: ctx => validateConfig(ctx.config)
});
