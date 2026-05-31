/**
 * @file router — Complex plugin wiring (logic in builders/, api.ts, state.ts).
 * @see README.md
 */
import { createPlugin } from "../../config";
import { i18nPlugin } from "../i18n";
import { sitePlugin } from "../site";
import { createApi } from "./api";
import { buildRouterTable } from "./builders/compile";
import { defineRoutes, route } from "./builders/route-builder";
import { createState } from "./state";
import type { RouterConfig } from "./types";

/** Default router config: empty route map (validated in onInit), hybrid mode. */
const defaultConfig: RouterConfig = { routes: {}, mode: "hybrid" };
/**
 * Router plugin — typed, named route definitions with locale-aware URL generation
 * and matching. Author routes with {@link route} + {@link defineRoutes}. Depends
 * on site (base URL) and i18n (locales).
 *
 * @example Define routes and choose a render mode
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     router: {
 *       routes: defineRoutes({
 *         home: route("/"),
 *         article: route("/blog/{slug}/")
 *       }),
 *       mode: "hybrid" // "ssg" | "spa" | "hybrid" (default)
 *     }
 *   }
 * });
 * ```
 */
export const routerPlugin = createPlugin("router", {
  depends: [sitePlugin, i18nPlugin],
  helpers: { route, defineRoutes },
  config: defaultConfig,
  createState,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; logic in builders/compile.ts
  onInit(ctx) {
    const i18n = ctx.require(i18nPlugin);
    const baseUrl = ctx.require(sitePlugin).url();
    ctx.state.table = buildRouterTable(ctx.config, baseUrl, i18n.locales(), i18n.defaultLocale());
  }
});
export { defineRoutes, route } from "./builders/route-builder";
