/**
 * @file router plugin — route DSL helpers.
 *
 * Pure helpers (no `ctx`, run before `createApp`): the `route()` fluent builder
 * factory and the `defineRoutes()` typed-identity helper. Re-exported from the
 * plugin `helpers` field and the framework barrel. The builder is a single mutable
 * object that doubles as the (erased) `RouteDefinition` carrier — it exposes
 * `pattern`, `_meta`, and `_handlers` live, so a built route is directly usable as
 * a `RouteMap` element while still offering the typed fluent chain.
 */
import type { RouteBuilder, RouteHandlers, RouteMap, RouteState } from "../types";

/** Mutable handler/meta carrier shared by every method of one builder instance. */
interface MutableRoute {
  /** URL pattern string. */
  readonly pattern: string;
  /** Accumulated metadata bag. */
  readonly _meta: Record<string, unknown>;
  /** Accumulated build-time handlers. */
  readonly _handlers: Record<string, unknown>;
}

/**
 * Create a fluent route builder from a URL pattern string. Captures the pattern
 * as a literal type for compile-time param inference; `.load()` is the only method
 * that widens the data generic, so `ctx.data` in `.render()`/`.head()` is typed by
 * `.load()`'s return at the CALL SITE. The returned object is itself the route
 * definition (`pattern` / `_meta` / `_handlers`), so it slots straight into a route map.
 *
 * @param pattern - URL pattern with `{param}` / `{param:?}` placeholders.
 * @returns A `RouteBuilder<RouteState<P>>` carrying the typed fluent chain.
 * @example
 * ```ts
 * route("/{lang:?}/{slug}/")
 *   .load(({ slug }) => loadArticle(slug))
 *   .render((ctx) => <Article a={ctx.data} />)
 *   .head((ctx) => ({ title: ctx.data.title }));
 * ```
 */
export function route<P extends string>(pattern: P): RouteBuilder<RouteState<P>> {
  const carrier: MutableRoute = { pattern, _meta: {}, _handlers: {} };
  const handlers = carrier._handlers;

  /**
   * Record a handler under `key` and return the same builder for chaining.
   *
   * @param key - The handler slot name.
   * @param fn - The handler function to store.
   * @returns The same builder instance, for fluent chaining.
   * @example
   * ```ts
   * set("render", handler);
   * ```
   */
  function set(key: keyof RouteHandlers, fn: unknown): RouteBuilder<RouteState<P>> {
    handlers[key] = fn;
    return builder;
  }

  const builder = {
    pattern: carrier.pattern,
    _meta: carrier._meta,
    _handlers: carrier._handlers as RouteHandlers,
    /**
     * Attach a data loader; widens the data generic for downstream handlers.
     *
     * @param loader - The loader producing this route's data.
     * @returns The same builder, with the data generic widened.
     * @example
     * ```ts
     * route("/{slug}/").load(({ slug }) => ({ slug }));
     * ```
     */
    load(loader: unknown) {
      return set("load", loader);
    },
    /**
     * Attach a layout wrapper component.
     *
     * @param component - The layout component.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/").layout((children) => children);
     * ```
     */
    layout(component: unknown) {
      return set("layout", component);
    },
    /**
     * Attach the page render handler.
     *
     * @param handler - The render handler.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/").render(() => null);
     * ```
     */
    render(handler: unknown) {
      return set("render", handler);
    },
    /**
     * Attach the head/SEO handler.
     *
     * @param handler - The head handler.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/").head(() => ({ title: "Home" }));
     * ```
     */
    head(handler: unknown) {
      return set("head", handler);
    },
    /**
     * Attach a static-generation param producer.
     *
     * @param handler - The param producer.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/{slug}/").generate(() => [{ slug: "x" }]);
     * ```
     */
    generate(handler: unknown) {
      return set("generate", handler);
    },
    /**
     * Merge an arbitrary metadata bag into the route's `_meta`.
     *
     * @param meta - Metadata to merge.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/").meta({ activeTab: "home" });
     * ```
     */
    meta(meta: Record<string, unknown>) {
      Object.assign(carrier._meta, meta);
      return builder;
    },
    /**
     * Attach a JSON serializer for the route's data.
     *
     * @param handler - The JSON serializer.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/api/").toJson(() => ({ ok: true }));
     * ```
     */
    toJson(handler: unknown) {
      return set("toJson", handler);
    },
    /**
     * Override the output file-path producer.
     *
     * @param handler - The file-path producer.
     * @returns The same builder for chaining.
     * @example
     * ```ts
     * route("/feed/").toFile(() => "feed.xml");
     * ```
     */
    toFile(handler: unknown) {
      return set("toFile", handler);
    }
  } as unknown as RouteBuilder<RouteState<P>>;

  return builder;
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
