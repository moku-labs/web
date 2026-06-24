/**
 * @file router plugin — type definitions skeleton.
 *
 * Holds the router's config/state/api types plus the public route DSL types
 * (`RouteBuilder`, `RouteState`, `ExtractRouteParams`, `RouteDefinition`,
 * `RouteMap`, `TypedRoute`) and the compiled matcher-table internals
 * (`CompiledRoute`, `MatcherTable`). All signatures are concrete per spec/05 §2–§4.
 */
import type { ComponentChildren, VNode } from "preact";
import type { PathMatcher } from "./iso-match";

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

/**
 * Render-time context handed to `.render()` / `.head()`; `data` is `.load()`'s return,
 * `meta` the route's `.meta()` bag.
 */
export interface RouteContext<S extends RouteState> {
  /** Resolved path params. */
  readonly params: S["params"];
  /** Loaded data (the return value of this route's `.load()`). */
  readonly data: S["data"];
  /** Active locale for this render. */
  readonly locale: string;
  /**
   * The route's `.meta()` bag (e.g. `{ activeTab: "home" }`). Available in `.render()` and
   * `.head()`, identically at build and on the client — `meta` is compiled into the route and
   * shipped in the client manifest, so a client-only route (dynamic, no `.generate()`, whose
   * `.load()` data is `{}` on the client) can feed static per-route config into its render.
   */
  readonly meta: Record<string, unknown>;
  /**
   * Build a link to a named route by pattern substitution — the framework delivers
   * this on the context (same output as `app.router.toUrl`), so render/head build
   * links with no `app`/`createUrls` reference. Works identically at build and on
   * client navigation.
   */
  readonly url: (name: string, params?: Record<string, string>) => string;
}

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier (mirrors the kernel's `ExtractApi` / spec/09 §3). Lets the loader/generator
 * `require` resolve a plugin instance to its typed public API.
 *
 * @example
 * type ContentApi = ExtractApi<typeof contentPlugin>;
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/**
 * Generic, instance-only `require` handed to a route's `.load()` / `.generate()` —
 * the SAME shape as the kernel's `RequireFunction` (spec/08 §7) and the build's
 * `PhaseRequire`, so the build forwards its own `ctx.require` straight through.
 * Resolves a plugin INSTANCE to its public API; the consumer supplies the instance
 * (e.g. `ctx.require(contentPlugin)`), so the router never names a sibling plugin.
 *
 * @example
 * const content = ctx.require(contentPlugin); // ContentApi
 */
export type RouteRequire = <
  PluginCandidate extends {
    readonly name: string;
    readonly spec: unknown;
    readonly _phantom: {
      readonly config: unknown;
      readonly state: unknown;
      readonly api: unknown;
      readonly events: Record<string, unknown>;
    };
  }
>(
  plugin: PluginCandidate
) => ExtractApi<PluginCandidate>;

/**
 * Build-time context handed to a route's `.load()`. Carries the resolved path
 * `params` and active `locale`, plus the spec's `require`/`has` so a loader pulls
 * sibling plugin APIs the canonical way — `ctx.require(contentPlugin)` — with no
 * module global and no router→content coupling. Loaders run ONLY at build time
 * (never on the client), inside the build plugin's context, so `require`/`has` are
 * always live here.
 *
 * @example
 * route("/{slug}/").load((ctx) => ctx.require(contentPlugin).load(ctx.params.slug, ctx.locale));
 */
export interface LoadContext<S extends RouteState> {
  /** Resolved path params for this page instance. */
  readonly params: S["params"];
  /** Active locale this page instance is built for. */
  readonly locale: string;
  /** Resolve a sibling plugin instance to its public API (spec/08 §7). */
  readonly require: RouteRequire;
  /** Whether a plugin is registered (by name) — branch on OPTIONAL plugins. */
  readonly has: (name: string) => boolean;
}

/**
 * Build-time context handed to a route's `.generate()` — the static-param producer.
 * Carries the active `locale` plus `require`/`has` (no `params` yet — `.generate()`
 * PRODUCES the param sets). Same build-only guarantee as {@link LoadContext}.
 *
 * @example
 * route("/{slug}/").generate(async (ctx) =>
 *   [...(await ctx.require(contentPlugin).loadAll()).get(ctx.locale) ?? []].map((a) => ({ slug: a.computed.slug })));
 */
export interface GenerateContext {
  /** Active locale to enumerate param sets for. */
  readonly locale: string;
  /** Resolve a sibling plugin instance to its public API (spec/08 §7). */
  readonly require: RouteRequire;
  /** Whether a plugin is registered (by name). */
  readonly has: (name: string) => boolean;
}

/**
 * Context handed to a route's `.layout()` wrapper — identical to {@link RouteContext}
 * (which now carries `meta` for every handler). Retained as a named alias so existing
 * `.layout((ctx, children) => …)` typings keep compiling.
 *
 * @remarks
 * The layout is applied in the SSG render path ONLY. On client (SPA) navigation the
 * chrome is persistent and the layout is intentionally NOT re-applied — only the inner
 * swap region is replaced. See `build`'s pages phase and `spa`'s kernel.
 */
export type LayoutContext<S extends RouteState> = RouteContext<S>;

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
 * Named view-transition behaviour for a navigation TO a route — a closed, typed
 * vocabulary the SPA kernel interprets (NOT free-form app data, so it earns a
 * first-class `.transition()` method instead of a `.meta()` key):
 * - `"none"` — swap with no View Transition (instant);
 * - `"crossfade"` — the default root crossfade (`startViewTransition(swap)`);
 * - `"slide"` / `"morph"` — a named transition; the kernel tags the transition with
 *   `types: ["slide"|"morph"]` so consumer CSS can target `:active-view-transition-type(slide)`
 *   (and shared `view-transition-name`s morph one element into another).
 *
 * A route's `.transition()` OVERRIDES the app-wide default (`spa.viewTransitions`).
 */
export type TransitionMode = "none" | "crossfade" | "slide" | "morph";

/**
 * Scroll behaviour for a navigation TO a route — a closed, typed vocabulary the SPA
 * kernel interprets (a first-class `.scroll()` method, not a `.meta()` key):
 * - `"top"` — reset to the top of the page on the swap (the default for forward navs);
 * - `"preserve"` — keep the current scroll position (e.g. opening an overlay/issue route
 *   over a board that must stay still). A route's `.scroll()` OVERRIDES `spa.scrollRestoration`.
 */
export type ScrollMode = "top" | "preserve";

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
    loader: (ctx: LoadContext<S>) => D | Promise<D>
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
  /** Attach the head/SEO handler. */
  head(handler: (ctx: RouteContext<S>) => HeadConfig): RouteBuilder<S>;
  /** Attach a static-generation param producer (receives a {@link GenerateContext}). */
  generate(
    handler: (ctx: GenerateContext) => S["params"][] | Promise<S["params"][]>
  ): RouteBuilder<S>;
  /**
   * Attach an arbitrary metadata bag. The bag MUST be JSON-serializable: it is
   * projected verbatim into `clientManifest()` and shipped to the browser.
   */
  meta(meta: Record<string, unknown>): RouteBuilder<S>;
  /**
   * Declare the view-transition behaviour for navigations TO this route — a typed
   * framework directive (the SPA kernel reads it), overriding the app-wide
   * `spa.viewTransitions` default. See {@link TransitionMode}.
   *
   * @example
   * route("/board/{id}/issue/{issueId}").transition("morph"); // card → panel
   */
  transition(mode: TransitionMode): RouteBuilder<S>;
  /**
   * Declare the scroll behaviour for navigations TO this route — a typed framework
   * directive (the SPA kernel reads it), overriding the app-wide
   * `spa.scrollRestoration` default. See {@link ScrollMode}.
   *
   * @example
   * route("/board/{id}/issue/{issueId}").scroll("preserve"); // overlay: don't move the board
   */
  scroll(mode: ScrollMode): RouteBuilder<S>;
  /** Attach a JSON serializer for the route's data. */
  toJson(handler: (ctx: RouteContext<S>) => unknown): RouteBuilder<S>;
  /** Override the output file-path producer. */
  toFile(handler: (params: S["params"]) => string): RouteBuilder<S>;
}

/** Build-only handler bag captured by a `RouteBuilder` (consumed by `build` via `manifest()`). */
export interface RouteHandlers {
  /** Data loader (receives a {@link LoadContext}: params + locale + require/has). */
  readonly load?: (ctx: LoadContext<RouteState>) => unknown;
  /** Layout wrapper (ctx-aware): frames the page in persistent chrome. SSG-only. */
  readonly layout?: (ctx: LayoutContext<RouteState>, children: ComponentChildren) => VNode;
  /** Page renderer. */
  readonly render?: (ctx: RouteContext<RouteState>) => VNode;
  /** Head/SEO producer. */
  readonly head?: (ctx: RouteContext<RouteState>) => HeadConfig;
  /** Static-generation param producer (receives a {@link GenerateContext}). */
  readonly generate?: (ctx: GenerateContext) => unknown[] | Promise<unknown[]>;
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
  /** Named view-transition behaviour from `.transition()` (read by the SPA kernel); undefined → app default. */
  readonly _transition?: TransitionMode;
  /** Scroll behaviour from `.scroll()` (read by the SPA kernel); undefined → app default. */
  readonly _scroll?: ScrollMode;
  /** Build-time handler bag (load/render/head/generate/toJson/toFile). */
  readonly _handlers: RouteHandlers;
}

/**
 * Map of route name → route definition. The element type is intentionally the
 * base (erased) `RouteDefinition`; this is the documented generic-erasure boundary.
 */
export type RouteMap = Record<string, RouteDefinition>;

/**
 * A pure, app-free URL builder over a route map (the return type of `createUrls`).
 * `toUrl` builds a route's path by name + params via pattern substitution — it needs
 * NO running app, router instance, base URL, or i18n: just the route map the consumer
 * already holds at module scope. Works identically at build, on client navigation,
 * and inside hydrated islands. Reuses the SAME `buildUrl` as the runtime `RouterApi`,
 * so the helper and the API can never diverge.
 *
 * @example
 * const url = createUrls(routes);
 * url.toUrl("article", { lang: "en", slug: "hello" }); // "/en/hello/"
 */
export interface Urls<T extends RouteMap> {
  /**
   * Build a route's URL path from its name and params. The name is typed to the
   * route map's keys — only declared routes are accepted.
   *
   * @param name - Route name key from the map (e.g. `"home"`, `"article"`).
   * @param params - Path params to substitute into the pattern. Defaults to `{}`.
   * @returns The resolved relative URL path.
   * @throws {Error} If `name` is not present in the route map.
   * @example
   * url.toUrl("home", { lang: "en" }); // "/en/"
   */
  toUrl<K extends keyof T & string>(name: K, params?: Record<string, string>): string;
}

/**
 * Configuration for the router plugin.
 *
 * @remarks
 * `routes` is the declarative route map — registered the normal config way via
 * `createApp({ pluginConfigs: { router: { routes } } })` and compiled into the matcher
 * table in the router's `onInit`. An `import * as routes` namespace is a valid value. It is
 * the SOLE registration path: omitting it leaves the matcher table empty, so every read
 * (`match`/`toUrl`/`entries`/…) throws. The render `mode` is NOT here — it is a GLOBAL
 * framework option (`createApp({ config: { mode } })`), read by the router via `ctx.global`.
 */
export type RouterConfig = {
  /** Declarative route map (route name → `route(...)`); compiled at init. An `import * as` namespace works. */
  readonly routes?: RouteMap;
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
  /** Pre-built path matchers (lang-aware + bare fallback). */
  readonly matchers: { readonly withLang: PathMatcher; readonly bare: PathMatcher };
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
 * Router plugin state — a mutable holder whose `table` is `null` until the router's
 * `onInit` compiles `config.routes`. The render `mode` is NOT stored here; it is read
 * from the global framework config via the API context. Keeps all mutable state in
 * `ctx.state` (no singletons).
 */
export interface RouterState {
  /** Compiled matcher table; `null` until `onInit` compiles `config.routes`. */
  table: MatcherTable | null;
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

/** Public API exposed via `ctx.require(routerPlugin)` and `app.router`. */
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
   * for (const def of ctx.require(routerPlugin).manifest()) def._handlers.render?.(routeContext);
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
