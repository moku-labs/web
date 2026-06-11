# router

> **Isomorphic default** — the single source of truth for the route table: a typed `route()` DSL, compile-time path-param inference, a specificity-sorted matcher, and locale-aware URL/file derivation.

The router owns route definition and resolution. Authors describe routes with the fluent `route()` builder (a pure helper that runs before `createApp`, with no `ctx`), register them declaratively via `pluginConfigs.router.routes` (the sole registration path, compiled in `onInit`), and downstream plugins (`build`, `head`, `spa`) consult the compiled table the canonical way via `ctx.require(routerPlugin)` — never by config readback. It `depends` on `site` (base URL) and `i18n` (locales + default locale), which it `ctx.require`s at compile time to build the lang-aware matchers. The render `mode` is **not** router config — it is a GLOBAL framework option (`createApp({ config: { mode } })`) that the router merely re-exposes via `mode()` as the single source of truth `build`/`spa` gate data navigation on.

Lifecycle stance: pure compute, **`onInit` only** — no `onStart`/`onStop`, because the router manages no browser or process resource. Its `ctx.state` is just a mutable `{ table }` holder, `null` until compiled. The single most important design decision is the **generic-erasure boundary**: per-route `TParams`/`TData` are a call-site property of `route()` + `defineRoutes()` and erase at the `RouteMap = Record<string, RouteDefinition>` carrier; build-time type recovery happens through the `manifest()` **API return**, not a config readback. The same `iso-match` core (placeholder parsing, specificity ordering, matcher compilation) is shared by the server table and the browser SPA so the two can never diverge.

## Example
```ts
// routes.tsx — plain per-route exports. A loader pulls sibling plugin APIs the spec
// way (ctx.require(pluginInstance)); links come from ctx.url(name, params).
import { route, contentPlugin } from "@moku-labs/web";

export const home = route("/").render(ctx => <Home url={ctx.url} />); // no .load() — optional
export const article = route("/{lang:?}/{slug}/")
  .load(ctx => ctx.require(contentPlugin).load(ctx.params.slug, ctx.locale)) // ctx.data typed from the return
  .render(ctx => <Article article={ctx.data} url={ctx.url} />)
  .head(ctx => ({ title: ctx.data.title }));
```

```ts
// app.ts — register routes via config (create → run).
import { createApp, buildPlugin, contentPlugin } from "@moku-labs/web";
import * as routes from "./routes";

const app = createApp({
  plugins: [contentPlugin, buildPlugin],     // content/build are node-only
  config: { mode: "hybrid" },                // GLOBAL "ssg" | "spa" | "hybrid" — the SSG/DATA/SPA switch
  pluginConfigs: {
    site: { name: "Blog", url: "https://blog.dev", author: "Alex", description: "…" },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    router: { routes }                       // declarative route map (an `import * as` namespace works)
  }
});
await app.build.run();    // or: await app.start(); — routes compiled at init from config
```

> [!NOTE]
> `ctx.data` in `.render`/`.head` is typed from **`.load()`'s return**; `.load` is OPTIONAL. `.load`/`.generate` run **build-only** and receive `{ params, locale, require, has, env, log }`, so a loader pulls sibling plugin APIs the canonical way — `ctx.require(contentPlugin)` — and reads build-time env via the flat-injected core APIs (spec/08 §2b) — `ctx.env.get("MY_VAR")` — with no module global and no router→content coupling. `.render`/`.head` receive **`ctx.url(name, params)`** — a link builder (backed by `router.toUrl`) the framework delivers, so links need no `app` reference.

## API
Reachable via `app.router` and `ctx.require(routerPlugin)`.

| Method | Signature | Notes |
|---|---|---|
| `match` | `(pathname: string) => { params; route: RouteDefinition } \| null` | Scans the specificity-sorted table; the most specific match wins, else `null`. |
| `toUrl` | `(routeName: string, params: Record<string, string>) => string` | Substitutes `{param}` / `{param:?}` into the named route's pattern; throws on an unknown name. |
| `entries` | `() => readonly TypedRoute[]` | URL-utility view (`pattern`/`name`/`meta` + `toUrl`/`toFile`/`match`), in **specificity** order. |
| `manifest` | `() => readonly RouteDefinition[]` | Full definitions carrying `_handlers` (load/layout/render/head/generate/toJson/toFile), in **declaration** order — the type-preserving API return `build` consumes. |
| `clientManifest` | `() => readonly ClientRoute[]` | Fresh, frozen, specificity-sorted projection of `{ pattern, name, meta }` with NO `_handlers` closures — JSON-serializable for client shipping (the SPA recompiles matchers lazily from `pattern`). |
| `mode` | `() => "ssg" \| "spa" \| "hybrid"` | The resolved render mode, read from GLOBAL config (`ctx.global.mode`) — the single source of truth `build`/`spa` read to gate data navigation. |

### Helpers (exported, no `ctx`, run before `createApp`)

Registered as plugin `helpers` and re-exported from the `@moku-labs/web` barrel.

| Helper | Signature | Notes |
|---|---|---|
| `route` | `<P extends string>(pattern: P) => RouteBuilder<RouteState<P>>` | The fluent builder. Captures the pattern as a literal for compile-time param inference; the returned object *is* its own `RouteDefinition` carrier, so it slots straight into a route map. Chain: `.load` (only method that widens `data`), `.layout`, `.render`, `.head`, `.generate`, `.meta`, `.toJson`, `.toFile`. |
| `defineRoutes` | `<T extends RouteMap>(routes: T) => T` | Typed identity helper — preserves the precise literal type of the route map for IntelliSense at the call site (before erasure). |
| `createUrls` | `<T extends RouteMap>(routes: T) => Urls<T>` | A pure, app-free URL builder. `url.toUrl(name, params)` reuses the SAME `buildUrl` as `RouterApi.toUrl`, so helper and API can never diverge — no running app, router instance, base URL, or i18n needed. Names are typed to the map's keys; throws on an unknown name. |

> [!NOTE]
> Routes are registered **only** declaratively via `pluginConfigs.router.routes`, compiled once in `onInit` — the config route map is the single source of truth. (A browser app that builds routes dynamically composes them into that config before `createApp`.)

## Configuration
`pluginConfigs.router` — all fields optional (defaults to `{}`).

| Field | Type | Default | Notes |
|---|---|---|---|
| `routes` | `RouteMap` | _omitted_ | Declarative route map (route name → `route(...)`); compiled at init. An `import * as routes` namespace is a valid value. It is the sole registration path — omit it and the matcher table stays empty, so every read (`match`/`toUrl`/`entries`/…) throws. |

The render `mode` is **not** here — it is a GLOBAL framework option (`createApp({ config: { mode } })`), read by the router via `ctx.global`.

## Dependencies
`depends: [sitePlugin, i18nPlugin]`. At compile time `registerRoutes` resolves both via `ctx.require`:

- `ctx.require(sitePlugin).url()` — site base URL.
- `ctx.require(i18nPlugin).locales()` — locale alternation used to build the `withLang` matcher.
- `ctx.require(i18nPlugin).defaultLocale()` — injected when the `bare` fallback matches.

The render `mode` is read from `ctx.global.mode`, not from a dependency.

## Design notes

**Matching model.** Each route compiles to **two** `URLPattern` matchers: `withLang` (the locale alternation injected for `{lang:?}`) and `bare` (the `{lang:?}/` segment stripped). The match function tries `withLang` first; on a miss it falls back to `bare` and injects the `defaultLocale`. The `compiled` array is sorted ascending by `dynamicSegmentCount` (static beats dynamic; fewer dynamic segments win), with declaration order as a **stable** tiebreak. The optional `{lang:?}` segment is excluded from the specificity count so locale-prefixing never changes priority. Numeric/regex group keys are stripped from extracted params (`extractGroups`).

**Validation.** Registration (`onInit` compiling `config.routes`) runs `validateRoutes` and compiles synchronously into `ctx.state.table`. It fails fast with the `[web] router` prefix on: an empty map, a pattern not starting with `/`, unbalanced `{…}` braces, or more than one `{lang:?}` segment.

**Generic-erasure mitigation.** The route map is an opaque carrier (`RouteMap = Record<string, RouteDefinition>`); per-route `TParams`/`TData` erase at that boundary. Type safety is a **call-site** property of `route()` + `defineRoutes()`, and per-route definition types are recovered for build time via the `manifest()` **API return**.

**Isomorphic core.** `iso-match.ts` imports nothing (no `node:*`, no DOM) and is the single source of placeholder parsing (`parsePlaceholder`), specificity (`dynamicSegmentCount`/`bySpecificity`), group extraction (`extractGroups`), native-`RegExp` matcher compilation (`createPathMatcher` — no `URLPattern` global, so matching works in every engine incl. Safari/Firefox without it), and lazy client matcher compilation (`compileClientMatcher`). The build-time compiler and the browser SPA both consume it, so server and client route resolution can never drift. URL generation collapses an absent optional segment cleanly (no double slash); file derivation always produces `…/index.html`, honoring a `.toFile()` override when present.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Plugin wiring: `depends`, `helpers`, `createState`, `api`, and the `onInit` that compiles `config.routes` via `registerRoutes`. |
| `iso-match.ts` | Isomorphic core (no `node:*`/DOM): `parsePlaceholder`, `dynamicSegmentCount`, `bySpecificity`, `extractGroups`, `createPathMatcher` (native-`RegExp`, `URLPattern`-free), `compileClientMatcher`. |
| `builders/route-builder.ts` | `route()` fluent builder + `defineRoutes()` identity + `createUrls()` pure URL builder. |
| `builders/compile.ts` | `validateRoutes`, `patternToUrlPattern`, `buildUrl`, `buildFilePath`, `compileRoutes`. |
| `builders/match.ts` | `createMatchFunction`, `extractParams` (re-exported `extractGroups`), `matchRoute`. |
| `api.ts` | `registerRoutes` (called by `onInit`) + the `createApi` closures: `match`/`toUrl`/`entries`/`manifest`/`clientManifest`/`mode`. |
| `state.ts` | The `{ table: null }` holder filled in `onInit`. |
| `types.ts` | Public DSL + internals: `RouteBuilder`, `RouteDefinition`, `RouteMap`, `ExtractRouteParams`, `TypedRoute`, `Urls<T>`, `CompiledRoute`, `MatcherTable`, `RouterConfig`, `RouterState`, `RouterApi`, plus the render/load/generate/layout context types. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
