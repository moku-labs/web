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

/**
 * Create and initialize a `@moku-labs/web` application — the Layer-3 entry point.
 * Your overrides are merged over the framework defaults through the 4-level config
 * cascade, every plugin's lifecycle runs, and a fully-typed, frozen app is returned.
 *
 * @param options - Optional configuration:
 *  - `pluginConfigs` — per-plugin overrides, keyed by plugin name
 *    (`site`, `i18n`, `router`, `content`, `head`, `build`, `spa`, `deploy`, `env`).
 *  - `config` — global framework config (e.g. `{ mode: "development" }`).
 *  - `plugins` — extra consumer plugins, merged into the app and its return type.
 *  - `onReady` / `onError` / `onStart` / `onStop` — lifecycle callbacks.
 * @returns The initialized app: `start()`, `stop()`, every plugin's API, and `log`.
 * @example
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     site: { name: "My Blog", url: "https://blog.dev", author: "Ada", description: "Notes" },
 *     router: { routes: defineRoutes({ home: route("/"), post: route("/blog/{slug}/") }) }
 *   }
 * });
 * await app.start();
 * ```
 */
export const createApp = framework.createApp;

/**
 * Create a custom plugin bound to this framework's `Config`/`Events` and core
 * APIs. Plugin types are inferred from the spec object — never written explicitly.
 * Pass the result to {@link createApp} via `plugins`.
 *
 * @example
 * ```ts
 * const analytics = createPlugin("analytics", {
 *   config: { writeKey: "" },
 *   api: (ctx) => ({ track: (event: string) => ctx.log.info("analytics:track", { event }) })
 * });
 *
 * const app = createApp({ plugins: [analytics] });
 * ```
 */
export const createPlugin = framework.createPlugin;

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
