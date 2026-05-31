/**
 * @file `@moku-labs/web/client` — the browser-safe entry point.
 *
 * Boots the SPA runtime (navigation interception + island component lifecycle) in
 * the browser WITHOUT importing the Node/SSG graph — no `node:*`, satori,
 * `@resvg/resvg-js`, shiki, gray-matter, feed, or preact-render-to-string. Bundle
 * this from your client entry (e.g. `src/main.ts`) with a browser target; the main
 * `@moku-labs/web` export stays server-only for the SSG build.
 * @see README.md
 */

import type { Config as HeadConfig } from "./plugins/head/types";
import type { Config as I18nConfig } from "./plugins/i18n/types";
import { createApi as createRouterApi } from "./plugins/router/api";
import { buildRouterTable } from "./plugins/router/builders/compile";
import type { RouterConfig } from "./plugins/router/types";
import type { Config as SiteConfig } from "./plugins/site/types";
import { boot, createClientState, navigate as navigateState } from "./plugins/spa/client";
import type {
  // eslint-disable-next-line unicorn/prevent-abbreviations -- ComponentDef is the canonical public type name per spec
  ComponentDef,
  SpaConfig,
  SpaState
} from "./plugins/spa/types";

export { defineRoutes, route } from "./plugins/router/builders/route-builder";
export { createComponent } from "./plugins/spa/components";
export type { ComponentDef, ComponentHooks, SpaConfig } from "./plugins/spa/types";

/**
 * Options for {@link hydrate}: the route map and config mirrored from the server
 * build, plus the island components to register before the first mount.
 */
export interface HydrateOptions {
  /** The same route map the server router was built with (via `defineRoutes` + `route`). */
  routes: RouterConfig["routes"];
  /** Island components to register before the initial mount (created with `createComponent`). */
  components?: ComponentDef[];
  /** Framework configuration mirrored from the server build. */
  config: {
    /** Site identity; `url` resolves route URLs. */
    site: SiteConfig;
    /** Locale registry; `locales`/`defaultLocale` drive locale-prefixed matching. */
    i18n: I18nConfig;
    /** Head config — accepted for parity with the server; the client reuses the server-rendered `<head>`. */
    head?: HeadConfig;
    /** SPA runtime options (swap selector, view transitions, progress bar). */
    spa?: SpaConfig;
  };
}

/** A live client handle returned by {@link hydrate}. */
export interface ClientApp {
  /**
   * Programmatically navigate to a path (no-op without a DOM).
   *
   * @param path - Target path, e.g. `/blog/hello/`.
   * @returns void
   * @example
   * app.navigate("/about/");
   */
  navigate(path: string): void;
  /**
   * Register an additional island component at runtime (last-registered-wins).
   *
   * @param component - A component definition created with `createComponent`.
   * @returns void
   * @example
   * app.register(modal);
   */
  register(component: ComponentDef): void;
}

/**
 * Boot the SPA runtime in the browser — navigation interception, region swapping,
 * and island component lifecycle — reusing the server's routes and config. Import
 * this from a browser-bundled client entry; it pulls NO Node/SSG dependencies.
 *
 * @param options - Routes, island components, and the mirrored site/i18n/head/spa config.
 * @returns A {@link ClientApp} handle to navigate or register components at runtime.
 * @example
 * ```ts
 * // src/main.ts — bundled with `bun build src/main.ts --target browser`
 * import { hydrate, route, defineRoutes } from "@moku-labs/web/client";
 * import { counter } from "./islands/counter";
 *
 * hydrate({
 *   routes: defineRoutes({ home: route("/"), post: route("/blog/{slug}/") }),
 *   components: [counter],
 *   config: {
 *     site: { name: "My Blog", url: "https://blog.dev", author: "Ada", description: "Notes" },
 *     i18n: { locales: ["en"], defaultLocale: "en" },
 *     spa: { viewTransitions: true }
 *   }
 * });
 * ```
 */
export function hydrate(options: HydrateOptions): ClientApp {
  const { routes, config } = options;

  // Build the (browser-safe) router table from the same routes the server used;
  // this also fail-fast validates the route map on a malformed pattern.
  const table = buildRouterTable(
    { routes, mode: "spa" },
    config.site.url,
    config.i18n.locales,
    config.i18n.defaultLocale
  );
  const router = createRouterApi({ state: { table } });

  const state: SpaState = createClientState();
  const spaConfig: SpaConfig = {
    ...config.spa,
    components: [...(config.spa?.components ?? []), ...(options.components ?? [])]
  };

  // `head` is intentionally omitted: the client reuses the server-rendered <head>
  // from each fetched document, so the kernel's head dependency is unused here.
  boot(state, spaConfig, { router });

  const handle: ClientApp = {
    // eslint-disable-next-line jsdoc/require-jsdoc -- documented on the ClientApp interface
    navigate: (path: string): void => {
      navigateState(state, path);
    },
    // eslint-disable-next-line jsdoc/require-jsdoc -- documented on the ClientApp interface
    register: (component: ComponentDef): void => {
      state.kernel?.register(component);
    }
  };
  return handle;
}
