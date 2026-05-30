/**
 * @file router plugin — route DSL helpers skeleton.
 *
 * Pure helpers (no `ctx`, run before `createApp`): the `route()` fluent builder
 * factory and the `defineRoutes()` typed-identity helper. Re-exported from the
 * plugin `helpers` field and the framework barrel.
 */
import type { RouteBuilder, RouteMap, RouteState } from "../types";

/**
 * Create a fluent route builder from a URL pattern string. Captures the pattern
 * as a literal type for compile-time param inference; `.load()` is the only method
 * that widens the data generic, so `ctx.data` in `.render()`/`.head()` is typed by
 * `.load()`'s return at the CALL SITE.
 *
 * @param _pattern - URL pattern with `{param}` / `{param:?}` placeholders.
 * @example
 * ```ts
 * route("/{lang:?}/{slug}/")
 *   .load(({ slug }) => loadArticle(slug))
 *   .render((ctx) => <Article a={ctx.data} />)
 *   .head((ctx) => ({ title: ctx.data.title }));
 * ```
 */
export function route<P extends string>(_pattern: P): RouteBuilder<RouteState<P>> {
  throw new Error("not implemented");
}

/**
 * Typed identity helper for route maps. Preserves the precise literal type of the
 * route object for IntelliSense at the consumer call site (before config erasure).
 *
 * @param routes - The route map object.
 * @returns The same object, with its precise type preserved.
 * @example
 * ```ts
 * const routes = defineRoutes({ home: route("/"), article: route("/{slug}/") });
 * ```
 */
export function defineRoutes<T extends RouteMap>(routes: T): T {
  return routes;
}
