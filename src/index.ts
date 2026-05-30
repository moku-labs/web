/**
 * @file `@moku-labs/web` — a Moku Layer-2 content static-site + SPA framework.
 * @see README.md
 */
import { coreConfig, createCore } from "./config";
import {
  buildPlugin,
  contentPlugin,
  deployPlugin,
  headPlugin,
  i18nPlugin,
  routerPlugin,
  sitePlugin,
  spaPlugin
} from "./plugins";

const framework = createCore(coreConfig, {
  // Canonical plugin-array order — every `depends` edge points backward (spec/11 §1.3/§1.5).
  plugins: [
    sitePlugin,
    i18nPlugin,
    routerPlugin,
    contentPlugin,
    headPlugin,
    buildPlugin,
    spaPlugin,
    deployPlugin
  ],
  // Framework default per-plugin configuration. Consumers override via
  // createApp({ pluginConfigs: { ... } }). (Populated during build.)
  pluginConfigs: {}
});

// ─── Plugins + Type namespaces ───────────────────────────────
export * from "./plugins";

// ─── Framework API ───────────────────────────────────────────
export const { createApp, createPlugin } = framework;

// ─── Consumer Helpers (NOT in the barrel) ────────────────────
export { defineRoutes, route } from "./plugins/router";
export {
  buildArticleHead,
  canonical,
  feedLink,
  hreflang,
  jsonLd,
  meta,
  og,
  twitter
} from "./plugins/head";
