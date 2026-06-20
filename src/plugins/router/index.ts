/**
 * @file router — Complex plugin wiring (logic in builders/, api.ts, state.ts).
 * @see README.md
 */
import { createPlugin } from "../../config";
import { sitePlugin } from "../site";
import { createApi, registerRoutes } from "./api";
import { createUrls, defineRoutes, route } from "./builders/route-builder";
import { createState } from "./state";
import type { RouterConfig } from "./types";

/** Default router config: `routes` omitted — provide it via `pluginConfigs.router.routes`. */
const defaultConfig: RouterConfig = {};
/**
 * Router plugin — typed, named route definitions with locale-aware URL generation
 * and matching. Author routes with {@link route}, then register them the normal config
 * way via `pluginConfigs.router.routes` (compiled at init). Depends on site (base URL);
 * i18n (locales) is OPTIONAL — falls back to a single default locale ("en") when absent.
 *
 * @example Register routes via config, then start/build
 * ```ts
 * import * as routes from "./routes";
 * const app = createApp({
 *   config: { mode: "hybrid" },               // render mode is GLOBAL config
 *   pluginConfigs: { router: { routes } }     // declarative route map (a namespace works)
 * });
 * await app.build.run();    // or: await app.start();  — routes compiled at init
 * ```
 */
export const routerPlugin = createPlugin("router", {
  depends: [sitePlugin],
  helpers: { route, defineRoutes, createUrls },
  config: defaultConfig,
  createState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring: compile config routes (if any) at init
  onInit: ctx => {
    if (ctx.config.routes) registerRoutes(ctx, ctx.config.routes);
  },
  api: createApi
});
export { createUrls, defineRoutes, route } from "./builders/route-builder";
