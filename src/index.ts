/**
 * @file `@moku-labs/web` — a Moku Layer-2 content static-site + SPA framework.
 *
 * This is the **Node** entry (`.`): the full SSG composition (8 default plugins +
 * the `log`/`env` core), the consumer factory chain ({@link createApp} plus the
 * three per-target helpers {@link createStaticApp} / {@link createHybridApp} /
 * {@link createSpaApp}), and the explicit public surface. Browser code must import
 * `@moku-labs/web/client` (the `node:*`-free `hydrate()` entry), NEVER this module
 * — importing here pulls the static SSG graph (`satori`, `feed`, `node:fs`, …).
 * @see README.md
 */
import type {
  AnyPluginInstance,
  App,
  CoreApisFromTuple,
  CoreConfigResult,
  CreateAppOptions
} from "@moku-labs/core";
import type { Config, Events } from "./config";
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
import { clientDataPlugin } from "./plugins/clientData";
import { defaultClientDataConfig } from "./plugins/clientData/config";
import { dotenv, processEnv } from "./plugins/env/providers";

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
  // Framework default per-plugin configuration. The Node env providers live HERE
  // (framework cascade level 2, spec/03 §5) — not in the shared `coreConfig` —
  // so the browser `./client` entry never drags `node:fs` into its bundle.
  // `.env.local` wins over `process.env`. Consumers override via `createApp`.
  pluginConfigs: {
    env: { providers: [dotenv(), processEnv()] }
  }
});

/** The framework's default Layer-2 plugin tuple (the full Node SSG composition). */
type DefaultPlugins = readonly [
  typeof sitePlugin,
  typeof i18nPlugin,
  typeof routerPlugin,
  typeof contentPlugin,
  typeof headPlugin,
  typeof buildPlugin,
  typeof spaPlugin,
  typeof deployPlugin
];

/** Core plugin tuple captured by `coreConfig` — supplies the `log`/`env` app APIs. */
type CorePlugins =
  typeof coreConfig extends CoreConfigResult<infer _C, infer _E, infer CP> ? CP : readonly [];

/** Core APIs (`log`, `env`) mounted on every app regardless of composition. */
type WebCoreApis = CoreApisFromTuple<CorePlugins>;

/** `createApp` options for a static target (no client-data plugin). */
type StaticAppOptions<E extends readonly AnyPluginInstance[]> = CreateAppOptions<
  Config,
  Events,
  DefaultPlugins[number] | E[number],
  [...E],
  WebCoreApis
>;

/** The app a static target returns — no `app.clientData`. */
type StaticAppResult<E extends readonly AnyPluginInstance[]> = App<
  Config,
  Events,
  DefaultPlugins[number] | E[number],
  WebCoreApis
>;

/** Consumer-facing `createApp` options for a client-data target (hybrid/spa). */
type DataAppOptions<E extends readonly AnyPluginInstance[]> = CreateAppOptions<
  Config,
  Events,
  DefaultPlugins[number] | typeof clientDataPlugin | E[number],
  [...E],
  WebCoreApis
>;

/**
 * Internal `createApp` argument once `clientDataPlugin` is prepended to the extras.
 * The extra-plugins parameter is the ARRAY element-union form (not a tuple) so
 * `ExtraPlugins[number]` reduces cleanly for a generic `E` — a `[A, ...E][number]`
 * tuple does not, which would break assignability of the returned `App` type.
 */
type DataAppArgument<E extends readonly AnyPluginInstance[]> = CreateAppOptions<
  Config,
  Events,
  DefaultPlugins[number] | typeof clientDataPlugin | E[number],
  (typeof clientDataPlugin | E[number])[],
  WebCoreApis
>;

/** The app a client-data target returns — includes `app.clientData`. */
type DataAppResult<E extends readonly AnyPluginInstance[]> = App<
  Config,
  Events,
  DefaultPlugins[number] | typeof clientDataPlugin | E[number],
  WebCoreApis
>;

// ─── Framework API ───────────────────────────────────────────

/**
 * Create and initialize a `@moku-labs/web` application — the Layer-3 entry point.
 * Your overrides are merged over the framework defaults through the 4-level config
 * cascade, every plugin's lifecycle runs, and a fully-typed, frozen app is returned.
 *
 * For the common targets prefer the per-target helpers — {@link createStaticApp}
 * (SSG), {@link createHybridApp} (SSR + JSON-fragment nav), {@link createSpaApp}
 * (pure SPA) — which bundle the correct `router.mode` and client-data wiring.
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

// ─── Per-target factory helpers (spec/01 §10 — consumers stay at Layer 3) ──

/**
 * Translate a `clientData.outputDir` (a build-time filesystem path relative to the
 * build `outDir`) into the matching `spa.dataDir` (a site-root-relative URL the
 * browser fetches the manifest from). E.g. `"_data"` → `"/_data/"`.
 *
 * @param outputDir - The `clientData.outputDir` value.
 * @returns The site-root-relative URL form, slash-wrapped.
 * @example
 * toDataDir("_data"); // "/_data/"
 */
function toDataDir(outputDir: string): string {
  let trimmed = outputDir;
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return `/${trimmed}/`;
}

/**
 * Static SSG target — per-route HTML only, no client-data layer. Bundles
 * `router.mode: "ssg"` and `spa.clientData: "off"`; adds NO extra plugins, so the
 * returned app type has no `app.clientData`. Build with `await app.build.run()`.
 *
 * @template ExtraPlugins - Consumer plugins merged into the app and its type.
 * @param options - Standard {@link createApp} options. The factory owns
 *  `router.mode` and `spa.clientData`; other overrides are preserved.
 * @returns The initialized SSG app.
 * @example
 * ```ts
 * const app = createStaticApp({
 *   pluginConfigs: { site, router: { routes }, content: { contentDir: "./content" } }
 * });
 * await app.start();
 * await app.build.run(); // writes per-route HTML; no _data sidecars
 * ```
 */
export const createStaticApp = <
  const ExtraPlugins extends readonly AnyPluginInstance[] = readonly []
>(
  options?: StaticAppOptions<ExtraPlugins>
): StaticAppResult<ExtraPlugins> =>
  // The merge only sets values (mode/clientData) on the SAME shape; the cast bridges
  // TS's object-spread vs. generic mapped-type (`pluginConfigs`) assignability gap.
  framework.createApp<ExtraPlugins>({
    ...options,
    pluginConfigs: {
      ...options?.pluginConfigs,
      router: { ...options?.pluginConfigs?.router, mode: "ssg" },
      spa: { ...options?.pluginConfigs?.spa, clientData: "off" }
    }
  } as StaticAppOptions<ExtraPlugins>);

/**
 * Hybrid target (the blog default) — SSR + JSON-fragment client navigation. Adds
 * {@link clientDataPlugin} (payload `"fragment"`), and bundles
 * `router.mode: "hybrid"`, `spa.clientData: "fragment"`, and `spa.dataDir` derived
 * from `clientData.outputDir`. Emit the sidecars after the build:
 * `await app.build.run(); await app.clientData.emit();`.
 *
 * @template ExtraPlugins - Consumer plugins merged into the app and its type.
 * @param options - Standard {@link createApp} options (may override
 *  `clientData.outputDir`; `spa.dataDir` is recomputed unless set explicitly).
 * @returns The initialized hybrid app (includes `app.clientData`).
 * @example
 * ```ts
 * const app = createHybridApp({
 *   pluginConfigs: { site, router: { routes }, content: { contentDir: "./content" } }
 * });
 * await app.start();
 * await app.build.run();
 * await app.clientData.emit();
 * ```
 */
export const createHybridApp = <
  const ExtraPlugins extends readonly AnyPluginInstance[] = readonly []
>(
  options?: DataAppOptions<ExtraPlugins>
): DataAppResult<ExtraPlugins> => {
  const outputDir =
    options?.pluginConfigs?.clientData?.outputDir ?? defaultClientDataConfig.outputDir;
  // `clientDataPlugin` is prepended to the extras (so the app type gains `clientData`);
  // the cast bridges TS's object-spread vs. generic mapped-type (`pluginConfigs`) gap.
  return framework.createApp<(typeof clientDataPlugin | ExtraPlugins[number])[]>({
    ...options,
    plugins: [clientDataPlugin, ...(options?.plugins ?? [])],
    pluginConfigs: {
      ...options?.pluginConfigs,
      router: { ...options?.pluginConfigs?.router, mode: "hybrid" },
      clientData: { ...options?.pluginConfigs?.clientData, payload: "fragment" },
      spa: { dataDir: toDataDir(outputDir), ...options?.pluginConfigs?.spa, clientData: "fragment" }
    }
  } as DataAppArgument<ExtraPlugins>);
};

/**
 * Pure-SPA target (app-like) — the client renders pages from data JSON. Adds
 * {@link clientDataPlugin} (payload `"data"`), and bundles `router.mode: "spa"`
 * and `spa.clientData: "data"`.
 *
 * @experimental Ships now, but the `"data"` render path is only validated AFTER
 *  the hybrid bundle-assertion green gate (web-parity wave 5); treat as
 *  experimental until then.
 * @template ExtraPlugins - Consumer plugins merged into the app and its type.
 * @param options - Standard {@link createApp} options (may override
 *  `clientData.outputDir`; `spa.dataDir` is recomputed unless set explicitly).
 * @returns The initialized pure-SPA app (includes `app.clientData`).
 * @example
 * ```ts
 * const app = createSpaApp({
 *   pluginConfigs: { site, router: { routes }, content: { contentDir: "./content" } }
 * });
 * await app.start();
 * await app.build.run();
 * await app.clientData.emit();
 * ```
 */
export const createSpaApp = <const ExtraPlugins extends readonly AnyPluginInstance[] = readonly []>(
  options?: DataAppOptions<ExtraPlugins>
): DataAppResult<ExtraPlugins> => {
  const outputDir =
    options?.pluginConfigs?.clientData?.outputDir ?? defaultClientDataConfig.outputDir;
  // See `createHybridApp` — `clientDataPlugin` prepended; cast bridges the merge gap.
  return framework.createApp<(typeof clientDataPlugin | ExtraPlugins[number])[]>({
    ...options,
    plugins: [clientDataPlugin, ...(options?.plugins ?? [])],
    pluginConfigs: {
      ...options?.pluginConfigs,
      router: { ...options?.pluginConfigs?.router, mode: "spa" },
      clientData: { ...options?.pluginConfigs?.clientData, payload: "data" },
      spa: { dataDir: toDataDir(outputDir), ...options?.pluginConfigs?.spa, clientData: "data" }
    }
  } as DataAppArgument<ExtraPlugins>);
};

// ─── Plugins (instances) ─────────────────────────────────────
// Explicit named re-exports (NOT `export *`) so node-only plugins stay
// tree-shakeable for mixed consumers and every export keeps its hover docs.

/** ClientData plugin — NOT a framework default; added by {@link createHybridApp}/{@link createSpaApp}. */
export { clientDataPlugin } from "./plugins/clientData";

// ─── Type namespaces (consumers access as `Router.RouteDefinition`, …) ───────
export * as Build from "./plugins/build/types";
export * as ClientData from "./plugins/clientData/types";
export * as Content from "./plugins/content/types";
export * as Deploy from "./plugins/deploy/types";
export * as Env from "./plugins/env/types";
export * as Head from "./plugins/head/types";
export * as Log from "./plugins/log/types";
export * as Router from "./plugins/router/types";
export * as Spa from "./plugins/spa/types";

// ─── Consumer Helpers ────────────────────────────────────────
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

export {
  buildPlugin,
  contentPlugin,
  deployPlugin,
  envPlugin,
  headPlugin,
  i18nPlugin,
  logPlugin,
  routerPlugin,
  sitePlugin,
  spaPlugin
} from "./plugins";
