/**
 * @file router plugin — type definitions skeleton.
 *
 * Holds the router's config/state/api types plus the public route DSL types
 * (`RouteBuilder`, `RouteState`, `ExtractRouteParams`, `RouteDefinition`,
 * `RouteMap`, `TypedRoute`) and the compiled matcher-table internals
 * (`CompiledRoute`, `MatcherTable`). All signatures are concrete per spec/05 §2–§4.
 */
import type { ComponentChildren, VNode } from "preact";

/**
 * Param contribution of a single path segment. `{name:?}` / `:name?` → optional;
 * `{name}` / `:name` → required; static segments contribute nothing.
 *
 * @example
 * type S = ExtractSegmentParameter<"{slug}">; // { slug: string }
 */
export type ExtractSegmentParameter<Segment extends string> = Segment extends `{${infer Name}:?}`
  ? { [K in Name]?: string }
  : Segment extends `{${infer Name}}`
    ? { [K in Name]: string }
    : Segment extends `:${infer Name}?`
      ? { [K in Name]?: string }
      : Segment extends `:${infer Name}`
        ? { [K in Name]: string }
        : Record<never, never>;

/**
 * Template-literal type that extracts path params from a URL pattern by walking
 * one `/`-delimited segment at a time (so mixed required/optional patterns infer
 * correctly). `{name}` / `:name` become required; `{name:?}` becomes optional.
 *
 * @example
 * type P = ExtractRouteParams<"/{lang:?}/{slug}/">; // { lang?: string; slug: string }
 */
export type ExtractRouteParams<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? ExtractSegmentParameter<Head> & ExtractRouteParams<Tail>
  : ExtractSegmentParameter<P>;

/** Flattens an intersection type into a single object literal for readable IntelliSense. */
export type Prettify<T> = { [K in keyof T]: T[K] };

/**
 * Accumulating generic carried by `RouteBuilder` as the fluent chain grows.
 * `P` is the pattern's extracted params; `D` is the data type produced by `.load()`.
 */
export interface RouteState<P extends string = string, D = unknown> {
  /** Path params inferred from the pattern. */
  readonly params: Prettify<ExtractRouteParams<P>>;
  /** Loaded data type produced by `.load()` (widened only by `.load()`). */
  readonly data: D;
}

/** Render-time context handed to `.render()` / `.head()`; `data` is `.load()`'s return. */
export interface RouteContext<S extends RouteState> {
  /** Resolved path params. */
  readonly params: S["params"];
  /** Loaded data (the return value of this route's `.load()`). */
  readonly data: S["data"];
  /** Active locale for this render. */
  readonly locale: string;
}

/**
 * Context handed to a route's `.layout()` wrapper: the render-time
 * {@link RouteContext} plus the route's `.meta()` bag, so persistent chrome (e.g. a
 * TopBar/TabNav) can read `locale` and `meta.activeTab`. Distinct from
 * `RouteContext` because the layout is the only handler that needs `meta`; keeping
 * it on its own type leaves `.render()`/`.head()` contexts unchanged.
 *
 * @remarks
 * The layout is applied in the SSG render path ONLY. On client (SPA) navigation the
 * chrome is persistent and the layout is intentionally NOT re-applied — only the
 * inner swap region is replaced. See `build`'s pages phase and `spa`'s kernel.
 */
export interface LayoutContext<S extends RouteState> extends RouteContext<S> {
  /** The route's `.meta()` bag (e.g. `{ activeTab: "home" }`). */
  readonly meta: Record<string, unknown>;
}

/** Head metadata produced by a route's `.head()` handler. */
export interface HeadConfig {
  /** Document title. */
  readonly title?: string;
  /** Meta description. */
  readonly description?: string;
  /** Arbitrary extra head fields. */
  readonly [key: string]: unknown;
}

/**
 * Fluent route builder. Each chain method returns the same builder with a
 * (possibly widened) state generic. Only `.load()` widens the data type `D`.
 */
export interface RouteBuilder<S extends RouteState> extends RouteDefinition {
  /**
   * Attach a data loader; widens the data generic (and ONLY the data generic) so
   * `.render()`/`.head()` see its return. Path params are preserved unchanged.
   */
  load<D>(
    loader: (params: S["params"], locale: string) => D | Promise<D>
  ): RouteBuilder<{ readonly params: S["params"]; readonly data: Awaited<D> }>;
  /**
   * Attach a ctx-aware layout wrapper that frames this route's rendered page in
   * persistent chrome. Receives the route's {@link LayoutContext} (render context +
   * `meta`) and the page `children`. Applied in the SSG render path ONLY — on client
   * navigation the chrome persists and only the inner swap region is replaced, so the
   * layout is not re-run.
   */
  layout(component: (ctx: LayoutContext<S>, children: ComponentChildren) => VNode): RouteBuilder<S>;
  /** Attach the page render handler. */
  render(handler: (ctx: RouteContext<S>) => VNode): RouteBuilder<S>;
  /**
   * Attach the client-side validation gate: parse the raw `unknown` fetched from
   * the persisted data file back into this route's data type `S["data"]`. Runs at
   * the trust boundary before `render` on the client (and MUST return `S["data"]`,
   * so a mismatched schema is a compile error). Throw inside it to reject malformed
   * data — `spa` then falls back to HTML-over-fetch. Use a hand guard or any
   * Standard-Schema validator (zod/valibot/arktype).
   */
  parse(handler: (raw: unknown) => S["data"]): RouteBuilder<S>;
  /** Attach the head/SEO handler. */
  head(handler: (ctx: RouteContext<S>) => HeadConfig): RouteBuilder<S>;
  /** Attach a static-generation param producer. */
  generate(handler: (locale: string) => S["params"][] | Promise<S["params"][]>): RouteBuilder<S>;
  /**
   * Attach an arbitrary metadata bag. The bag MUST be JSON-serializable: it is
   * projected verbatim into `clientManifest()` and shipped to the browser.
   */
  meta(meta: Record<string, unknown>): RouteBuilder<S>;
  /** Attach a JSON serializer for the route's data. */
  toJson(handler: (ctx: RouteContext<S>) => unknown): RouteBuilder<S>;
  /** Override the output file-path producer. */
  toFile(handler: (params: S["params"]) => string): RouteBuilder<S>;
}

/** Build-only handler bag captured by a `RouteBuilder` (consumed by `build` via `manifest()`). */
export interface RouteHandlers {
  /** Data loader. */
  readonly load?: (params: Record<string, string>, locale: string) => unknown;
  /** Layout wrapper (ctx-aware): frames the page in persistent chrome. SSG-only. */
  readonly layout?: (ctx: LayoutContext<RouteState>, children: ComponentChildren) => VNode;
  /** Page renderer. */
  readonly render?: (ctx: RouteContext<RouteState>) => VNode;
  /** Client-side validation gate: `unknown` (fetched JSON) → the route's data type, or throw. */
  readonly parse?: (raw: unknown) => unknown;
  /** Head/SEO producer. */
  readonly head?: (ctx: RouteContext<RouteState>) => HeadConfig;
  /** Static-generation param producer. */
  readonly generate?: (locale: string) => unknown[] | Promise<unknown[]>;
  /** JSON serializer. */
  readonly toJson?: (ctx: RouteContext<RouteState>) => unknown;
  /** Output file-path producer. */
  readonly toFile?: (params: Record<string, string>) => string;
}

/**
 * A single route definition: the (erased) carrier produced by `route(...)`.
 * Build consumes `_handlers` via `manifest()`; per-route param/data integrity
 * is a call-site property established before config erasure.
 */
export interface RouteDefinition {
  /** URL pattern string, e.g. `/{lang:?}/{slug}/`. */
  readonly pattern: string;
  /** Metadata bag accumulated from `.meta()` (named `_meta` to avoid clashing with the `.meta()` builder method). */
  readonly _meta: Record<string, unknown>;
  /** Build-time handler bag (load/render/head/generate/toJson/toFile). */
  readonly _handlers: RouteHandlers;
}

/**
 * Map of route name → route definition. The element type is intentionally the
 * base (erased) `RouteDefinition`; this is the documented generic-erasure boundary.
 */
export type RouteMap = Record<string, RouteDefinition>;

/**
 * Configuration for the router plugin.
 *
 * @remarks
 * `routes` is an OPAQUE carrier at the config boundary — the framework `Config`
 * generic erases the per-route element types (spec/05 §8, spec/09 §4). Downstream
 * plugins read the typed route set via `ctx.require(routerPlugin).manifest()`.
 */
export type RouterConfig = {
  /**
   * Named route definitions. Element type erases to the base `RouteDefinition`
   * at this config boundary; per-route call-site types are preserved only through
   * `defineRoutes()` + `route()` at the consumer and re-exposed via `manifest()`.
   */
  routes: RouteMap;
  /**
   * Render mode for URL/file resolution. Defaults to `"hybrid"`.
   * - `"ssg"` static generation only (no client router emitted).
   * - `"spa"` client-side routing only.
   * - `"hybrid"` static HTML + client navigation overlay.
   */
  mode?: "ssg" | "spa" | "hybrid";
};

/** A resolved route exposing URL utilities with typed params (port of legacy TypedRoute). */
export interface TypedRoute<TParams = Record<string, string>> {
  /** URL pattern string, e.g. `/{lang:?}/{slug}/`. */
  readonly pattern: string;
  /** Route name key. */
  readonly name: string;
  /** Metadata bag from `.meta()`. */
  readonly meta: Record<string, unknown>;
  /** Build a URL from typed params. */
  toUrl(params: TParams): string;
  /** Build an output file path from typed params. */
  toFile(params: TParams): string;
  /** Match a pathname into typed params, or `null`. */
  match(pathname: string): TParams | null;
}

/** A single compiled route entry: name, pattern, specificity, matchers, URL utilities. */
export interface CompiledRoute {
  /** Route name key from the route map. */
  readonly name: string;
  /** Original user pattern, e.g. `/{lang:?}/{slug}/`. */
  readonly pattern: string;
  /** Dynamic-segment count (lower = more specific = matched first). */
  readonly dynamicSegmentCount: number;
  /** Pre-built URLPattern matchers (lang-aware + bare fallback). */
  readonly matchers: { readonly withLang: URLPattern; readonly bare: URLPattern };
  /** Resolve pathname into params (withLang first, then bare with defaultLocale injected). */
  readonly matchFn: (pathname: string) => Record<string, string> | null;
  /** Build a URL from params. */
  readonly toUrl: (params: Record<string, string>) => string;
  /** Build an output file path from params. */
  readonly toFile: (params: Record<string, string>) => string;
  /** The original (opaque) RouteDefinition — preserved for `manifest()`. */
  readonly definition: RouteDefinition;
  /** Route metadata bag from `.meta()`. */
  readonly meta: Record<string, unknown>;
}

/** The compiled matcher table (immutable once `onInit` assigns it). */
export interface MatcherTable {
  /** All compiled routes, sorted by specificity (fewest dynamic segments first). */
  readonly compiled: readonly CompiledRoute[];
  /** Name → CompiledRoute index for O(1) `toUrl(name, ...)` lookups. */
  readonly byName: ReadonlyMap<string, CompiledRoute>;
}

/**
 * Router plugin state. `createState` runs with minimal context and returns a
 * mutable holder whose `table` is `null` until `onInit` (which has full context)
 * compiles and assigns it. Keeps all mutable state in `ctx.state` (no singletons).
 */
export interface RouterState {
  /** Compiled matcher table; `null` until `onInit` assigns it. */
  table: MatcherTable | null;
  /** Resolved render mode (single source of truth; set in `onInit`). Defaults `"hybrid"`. */
  mode: "ssg" | "spa" | "hybrid";
}

/** Plain-data input to `compileRoutes` — resolved DATA only, never the plugin ctx. */
export interface CompileInput {
  /** The opaque route map from config. */
  readonly routes: RouteMap;
  /** Resolved render mode. */
  readonly mode: "ssg" | "spa" | "hybrid";
  /** Site base URL (from `ctx.require(sitePlugin).url()`). */
  readonly baseUrl: string;
  /** Available locales (from `ctx.require(i18nPlugin).locales()`). */
  readonly locales: readonly string[];
  /** Default locale used for bare-pattern fallback. */
  readonly defaultLocale: string;
}

/**
 * Serializable route entry for the client route-index — a projection of the
 * compiled route table with NO `_handlers` closures, safe to ship to the browser
 * (the SPA recompiles matchers lazily from `pattern`).
 *
 * @remarks
 * `meta` MUST be JSON-serializable: `clientManifest()` is intended to survive a
 * `JSON.stringify`/`JSON.parse` round-trip, so a route's `.meta()` bag must contain
 * only JSON-safe values (no functions, symbols, or class instances).
 */
export interface ClientRoute {
  /** URL pattern string, e.g. `/{lang:?}/{slug}/`. */
  readonly pattern: string;
  /** Route name key from the route map. */
  readonly name: string;
  /** Route metadata bag from `.meta()`. MUST be JSON-serializable. */
  readonly meta: Record<string, unknown>;
}

/** Public API exposed via `ctx.require(routerPlugin)`. */
export type RouterApi = {
  /**
   * Match a pathname against the compiled route table (specificity-sorted).
   *
   * @param pathname - URL pathname, e.g. `/en/hello/`.
   * @returns `{ params, route }` for the most specific match, or `null` if none.
   * @example
   * const hit = ctx.require(routerPlugin).match("/en/hello/");
   */
  match(pathname: string): { params: Record<string, string>; route: RouteDefinition } | null;
  /**
   * Build a URL for a named route from params.
   *
   * @param routeName - Route name key from the route map.
   * @param params - Param values to substitute into the pattern.
   * @returns The resolved URL string (e.g. `/en/hello/`).
   * @throws {Error} If `routeName` is unknown.
   * @example
   * ctx.require(routerPlugin).toUrl("article", { lang: "en", slug: "hello" });
   */
  toUrl(routeName: string, params: Record<string, string>): string;
  /**
   * All resolved routes as typed URL utilities, in specificity order.
   *
   * @returns Read-only array of resolved typed routes.
   * @example
   * for (const r of ctx.require(routerPlugin).entries()) { r.toUrl({ slug: "x" }); }
   */
  entries(): readonly TypedRoute[];
  /**
   * The typed route set for build-time consumption (the KEY mechanism). An API
   * return, NOT a config readback — preserves per-route types despite config erasure.
   *
   * @returns Read-only array of the typed route definitions, in declaration order.
   * @example
   * for (const def of ctx.require(routerPlugin).manifest()) { def._handlers.load?.({}, "en"); }
   */
  manifest(): readonly RouteDefinition[];
  /**
   * Serializable, specificity-sorted projection of the route table for client
   * shipping. Maps the compiled table to `{ pattern, name, meta }` entries with NO
   * `_handlers` closures, returned as a fresh frozen array. JSON-serializable so the
   * SPA can embed it and recompile matchers lazily in the browser.
   *
   * @returns A fresh, frozen, specificity-sorted read-only array of {@link ClientRoute}.
   * @example
   * const json = JSON.stringify(ctx.require(routerPlugin).clientManifest());
   */
  clientManifest(): readonly ClientRoute[];
  /**
   * The resolved render mode — the single source of truth for static/hybrid/spa
   * behavior. `build` reads it to decide whether to emit client data sidecars;
   * `spa` reads it to decide whether to attempt client DATA navigation.
   *
   * @returns `"ssg" | "spa" | "hybrid"`.
   * @example
   * if (ctx.require(routerPlugin).mode() !== "ssg") { ... }
   */
  mode(): "ssg" | "spa" | "hybrid";
};

/** Re-export under the canonical `Config` name for the plugin-types barrel. */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- intentional barrel-canonical name
export type Config = RouterConfig;
/** Re-export under the canonical `State` name for the plugin-types barrel. */
export type State = RouterState;
/** Re-export under the canonical `Api` name for the plugin-types barrel. */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- intentional barrel-canonical name
export type Api = RouterApi;
