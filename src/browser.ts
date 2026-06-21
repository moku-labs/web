/**
 * @file `@moku-labs/web/browser` — the browser-safe entry point.
 *
 * A node-excluded view of the main `@moku-labs/web` entry: the SAME `createApp`
 * over the SAME isomorphic plugin set (`site`, `i18n`, `router`, `head`, `spa`,
 * plus the `log`/`env` core), but with **zero** node/native code in its static
 * import graph. Where the main entry re-exports the node-only plugins
 * (`content`/`build`/`deploy`) and the node env providers (`dotenv`/`processEnv`/
 * `cloudflareBindings`, which import `node:fs`), this entry omits them entirely —
 * so importing it can never drag the Node graph into a client bundle, regardless
 * of the consumer's bundler or tree-shaking. Built as its own ESM-only pass so the
 * graph never even references the node-only modules (see `tsdown.config.ts`).
 *
 * It also pre-wires `browserEnv()` as the default `env` provider, so env (and
 * `import.meta.env`-based dev/prod/test detection) works with zero consumer config.
 *
 * The optional `data` plugin is exported (its read-half is browser-safe) but, like
 * in the main entry, is consumer-composed for `router.mode("spa"|"hybrid")`.
 * @see src/index.ts — the full (Node-capable) entry.
 */
import { coreConfig, createCore } from "./config";
import { browserEnv } from "@moku-labs/common/browser";
import { headPlugin } from "./plugins/head";
import { i18nPlugin } from "./plugins/i18n";
import { routerPlugin } from "./plugins/router";
import { sitePlugin } from "./plugins/site";
import { spaPlugin } from "./plugins/spa";

// ─── Plugin instances (browser-safe; node-only build/deploy omitted) ──────────
export { sitePlugin } from "./plugins/site";
export { i18nPlugin } from "./plugins/i18n";
export { routerPlugin } from "./plugins/router";
export { headPlugin } from "./plugins/head";
export { spaPlugin } from "./plugins/spa";
export { dataPlugin } from "./plugins/data";

// contentPlugin is the browser-safe SHELL (the node markdown source lives in the
// `fileSystemContent` provider, which is NOT exported here). Routes import contentPlugin
// for `ctx.require(contentPlugin)` in build-only loaders; on the client those loaders
// never run, so no provider is composed and no node code reaches the bundle.
export { contentPlugin } from "./plugins/content";
export { envPlugin, logPlugin } from "@moku-labs/common/browser";

// ─── env provider (browser-only; also the pre-wired default below) ────────────
export { browserEnv } from "@moku-labs/common/browser";

// ─── Consumer helpers: route DSL, SPA islands, SEO <head> primitives ──────────
export { createUrls, defineRoutes, route } from "./plugins/router";
export { createIsland, lazyEmbed } from "./plugins/spa";
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

// ─── Plugin type namespaces (node-only Build/Deploy omitted) ──────────────────
export * as Content from "./plugins/content/types";
export * as Data from "./plugins/data/types";
export type { Env } from "@moku-labs/common/browser";
export * as Head from "./plugins/head/types";
export type { Log } from "@moku-labs/common/browser";
export * as Router from "./plugins/router/types";
export * as Spa from "./plugins/spa/types";

const core = createCore(coreConfig, {
  // Same isomorphic defaults as `src/index.ts`. Imported per-path (never the
  // `./plugins` barrel) so the node-only plugins stay out of this graph.
  plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin],
  // Browser default: pre-wire the node-free `browserEnv()` provider so env resolves
  // from `import.meta.env` / `globalThis.__ENV__` out of the box. Overridable by the
  // consumer at `createApp({ pluginConfigs: { env: { providers } } })`.
  pluginConfigs: { env: { providers: [browserEnv()] } }
});

/**
 * Create and initialize a browser-safe `@moku-labs/web` application — the Layer-3
 * entry point for client bundles. Identical to the main entry's `createApp`, but
 * this module's import graph contains zero node/native code, and `env` defaults to
 * the `browserEnv()` provider (reads `import.meta.env` / `globalThis.__ENV__`).
 *
 * The defaults are the isomorphic plugin set (`site`, `i18n`, `router`, `head`,
 * `spa` + `log`/`env` core). For client-data navigation (`router.mode("spa"|"hybrid")`)
 * compose the `data` plugin — its consume-half (`at()`) is browser-safe.
 *
 * @param options - Optional configuration:
 *  - `pluginConfigs` — per-plugin overrides, keyed by plugin name.
 *  - `config` — global framework config (e.g. `{ mode: "spa" }`).
 *  - `plugins` — extra plugins (e.g. `dataPlugin` or your own) merged into the app and its type.
 *  - `onReady` / `onError` / `onStart` / `onStop` — lifecycle callbacks.
 * @returns The initialized app: `start()`, `stop()`, every plugin's API, and `log`.
 * @example
 * ```ts
 * // Client SPA — env works with no wiring (browserEnv is the default provider):
 * import * as routes from "./routes";
 * const app = createApp({ config: { mode: "spa" }, pluginConfigs: { router: { routes } } });
 * await app.start();             // routes compiled at init from config
 * app.env.get("PUBLIC_API_URL"); // resolved from import.meta.env
 * ```
 */
export const createApp = core.createApp;

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
export const createPlugin = core.createPlugin;
