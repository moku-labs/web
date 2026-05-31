/**
 * @file `@moku-labs/web/client` — browser-safe hydrate entry point.
 *
 * The browser counterpart to the root (Node SSG) entry. Imported as
 * `@moku-labs/web/client`, it composes ONLY the browser-safe plugins
 * (`[site, i18n, router, head, spa]`) over `browserEnv()` and boots a real
 * Layer-3 app, whose `spa` `onStart` mounts islands onto the SSR'd DOM. Every
 * import here is `node:*`-free — the browser-safe plugins are pulled from their
 * individual modules (NOT the `./plugins` barrel, which statically references the
 * node-only `build`/`content`/`deploy` plugins). This keeps the client bundle free
 * of `node:`/`satori`/`@resvg`/`@shikijs`/`gray-matter`/`feed`.
 * @see README.md
 */
import { coreConfig, createCore } from "./config";
import { browserEnv } from "./plugins/env/providers.browser";
import { headPlugin } from "./plugins/head";
import { i18nPlugin } from "./plugins/i18n";
import { routerPlugin } from "./plugins/router";
import { sitePlugin } from "./plugins/site";
import { spaPlugin } from "./plugins/spa";

/**
 * The browser-safe Layer-2 composition. Same `coreConfig` as the Node entry (one
 * `createCoreConfig`, D1b), but the `env` provider is swapped to `browserEnv()`
 * and the node-only plugins (`build`/`content`/`deploy`) are omitted — consumers
 * never add them on the client.
 */
const browser = createCore(coreConfig, {
  plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin],
  pluginConfigs: {
    // Browser env provider (reads `import.meta.env` + a `globalThis` snapshot);
    // contains no `node:*`, so the client bundle stays Node-free (D1b).
    env: { providers: [browserEnv()] }
  }
});

/**
 * Options accepted by {@link hydrate} — the same per-plugin overrides the
 * browser-safe `createApp` accepts: `pluginConfigs` (e.g. `router.routes`,
 * `spa.components`, `site`), global `config`, and lifecycle callbacks.
 */
export type HydrateOptions = NonNullable<Parameters<typeof browser.createApp>[0]>;

/**
 * Module-scoped guard so a page hydrates at most once. Holds the in-flight (or
 * settled) `start()` promise; a second `hydrate()` call returns it unchanged
 * rather than booting the SPA kernel twice (which would throw). Single-app-per-
 * document by design (spec/08 §4).
 */
let session: Promise<void> | undefined;

/**
 * Hydrate the SSR-rendered page in the browser: compose the browser-safe plugin
 * set over `browserEnv()`, start a real Layer-3 app, and let the `spa` plugin
 * mount islands onto the existing DOM. Idempotent — calling it again returns the
 * first hydration's promise without re-booting.
 *
 * @param options - Routes, island components, and client config (via `pluginConfigs`).
 * @returns A promise that resolves once the app has started and islands are mounted.
 * @example
 * ```ts
 * import { hydrate } from "@moku-labs/web/client";
 * import { defineRoutes, route } from "@moku-labs/web";
 *
 * await hydrate({
 *   pluginConfigs: {
 *     site: { name: "My Blog", url: "https://blog.dev", author: "Ada", description: "Notes" },
 *     router: { routes: defineRoutes({ home: route("/") }) }
 *   }
 * });
 * ```
 */
export function hydrate(options?: HydrateOptions): Promise<void> {
  if (session) return session;
  const app = browser.createApp(options);
  session = app.start();
  return session;
}

export { browserEnv } from "./plugins/env/providers.browser";
