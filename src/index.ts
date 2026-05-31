/**
 * @file `@moku-labs/web` — a Moku Layer-2 content static-site + SPA framework.
 *
 * `createApp`'s defaults are the **isomorphic** plugins that run unchanged on both
 * Node and the browser (`site`, `i18n`, `router`, `head`, `spa`, plus the
 * `log`/`env` core). The Node-only plugins (`content`, `build`, `deploy`,
 * `clientData`) are exported for Layer-3 composition: add them with
 * `createApp({ plugins: [...] })` in a Node build; omit them in a browser app.
 * The framework never hard-blocks either runtime — the consumer composes the
 * variant it needs and supplies the matching `env` provider.
 * @see README.md
 */
import { coreConfig, createCore } from "./config";
import { headPlugin, i18nPlugin, routerPlugin, sitePlugin, spaPlugin } from "./plugins";

const framework = createCore(coreConfig, {
  // Isomorphic defaults — each runs on Node AND in the browser; every `depends`
  // edge points backward (spec/11 §1.3/§1.5). Node-only plugins (content, build,
  // deploy, clientData) are added per-target by the consumer (Layer 3, spec/01 §10).
  plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin],
  pluginConfigs: {}
});

// ─── Plugins + type namespaces (Layer-3 composition surface) ──────────────────
export * from "./plugins";
export { clientDataPlugin } from "./plugins/clientData";

// ─── env providers (compose per target: dotenv/processEnv on Node, browserEnv in the browser) ──
export { cloudflareBindings, dotenv, processEnv } from "./plugins/env/providers";
export { browserEnv } from "./plugins/env/providers.browser";

// ─── Framework API ────────────────────────────────────────────────────────────

/**
 * Create and initialize a `@moku-labs/web` application — the Layer-3 entry point.
 * Your overrides are merged over the framework defaults through the 4-level config
 * cascade, every plugin's lifecycle runs, and a fully-typed, frozen app is returned.
 *
 * The defaults are the isomorphic plugin set (`site`, `i18n`, `router`, `head`,
 * `spa` + `log`/`env` core). Add the Node-only plugins for an SSG build:
 * `createApp({ plugins: [contentPlugin, buildPlugin, deployPlugin] })`.
 *
 * @param options - Optional configuration:
 *  - `pluginConfigs` — per-plugin overrides, keyed by plugin name.
 *  - `config` — global framework config (e.g. `{ mode: "development" }`).
 *  - `plugins` — extra plugins (Node-only built-ins or your own) merged into the app and its type.
 *  - `onReady` / `onError` / `onStart` / `onStop` — lifecycle callbacks.
 * @returns The initialized app: `start()`, `stop()`, every plugin's API, and `log`.
 * @example
 * ```ts
 * // Node SSG build — add the node-only plugins:
 * const app = createApp({
 *   plugins: [contentPlugin, buildPlugin, deployPlugin],
 *   pluginConfigs: {
 *     site: { name: "My Blog", url: "https://blog.dev", author: "Ada", description: "Notes" },
 *     router: { routes: defineRoutes({ home: route("/"), post: route("/blog/{slug}/") }) }
 *   }
 * });
 * await app.start();
 * await app.build.run();
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

// ─── Consumer helpers ───────────────────────────────────────────────────────────
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
